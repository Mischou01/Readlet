package io.github.mischou01.readlet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat

/**
 * Keeps read-aloud going with the screen off and shows its controls in the notification shade and
 * on the lock screen.
 *
 * Speaking itself happens in [Speech]; this foreground service keeps the app's process (and its
 * WebView, which queues the next paragraph) alive and awake while reading, holds audio focus, and
 * turns media controls (the notification, the lock screen, headset buttons) into remote actions
 * for the UI. It runs from the moment read-aloud starts until it's closed, including while paused,
 * since Android doesn't let a backgrounded app start a foreground service again.
 */
class PlaybackService : Service() {
  data class Session(
    val title: String,
    val chapter: String?,
    val coverPath: String?,
    val playing: Boolean,
  )

  companion object {
    private const val CHANNEL_ID = "read-aloud"
    private const val NOTIFICATION_ID = 1
    private const val ACTION_UPDATE = "io.github.mischou01.readlet.UPDATE"
    private const val ACTION_REMOTE = "io.github.mischou01.readlet.REMOTE"
    private const val EXTRA_ACTION = "action"

    /** Where remote actions go: the plugin, which passes them to the UI. */
    var onRemoteAction: ((String) -> Unit)? = null

    private var instance: PlaybackService? = null
    private var pending: Session? = null

    fun update(context: Context, session: Session) {
      val running = instance
      if (running != null) {
        running.show(session)
        return
      }
      pending = session
      context.startForegroundService(
        Intent(context, PlaybackService::class.java).setAction(ACTION_UPDATE)
      )
    }

    fun stop(context: Context) {
      pending = null
      instance?.finish() ?: context.stopService(Intent(context, PlaybackService::class.java))
    }
  }

  private lateinit var mediaSession: MediaSession
  private lateinit var audio: AudioManager
  private lateinit var wakeLock: PowerManager.WakeLock
  private var session: Session? = null
  private var cover: Pair<String, Bitmap?>? = null
  private var focus: AudioFocusRequest? = null
  /** Paused because another app took audio focus for a moment; resume when it gives it back. */
  private var pausedForFocus = false

  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      // Headphones unplugged: don't carry on through the speaker.
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) remote("pause")
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    audio = getSystemService(AudioManager::class.java)
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Readlet:read-aloud")
      .apply { setReferenceCounted(false) }
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.read_aloud_channel), NotificationManager.IMPORTANCE_LOW)
        .apply { setShowBadge(false) }
    )
    mediaSession = MediaSession(this, "Readlet").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = remote("play")
        override fun onPause() = remote("pause")
        override fun onSkipToNext() = remote("next")
        override fun onSkipToPrevious() = remote("previous")
        override fun onStop() = remote("stop")
      })
      isActive = true
    }
    ContextCompat.registerReceiver(
      this,
      noisy,
      IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_REMOTE -> intent.getStringExtra(EXTRA_ACTION)?.let { remote(it) }
      else -> {
        val session = pending ?: this.session
        pending = null
        if (session == null) {
          // Restarted without anything to read (the process was recreated): nothing to show.
          stopSelf()
          return START_NOT_STICKY
        }
        show(session)
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    instance = null
    unregisterReceiver(noisy)
    abandonFocus()
    if (wakeLock.isHeld) wakeLock.release()
    mediaSession.release()
    super.onDestroy()
  }

  private fun remote(action: String) {
    onRemoteAction?.invoke(action)
  }

  private fun finish() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun show(session: Session) {
    this.session = session
    if (session.playing) {
      requestFocus()
      // A safety limit; every new state renews it.
      wakeLock.acquire(60 * 60 * 1000L)
    } else if (wakeLock.isHeld) {
      wakeLock.release()
    }

    val art = coverBitmap(session.coverPath)
    mediaSession.setMetadata(
      MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, session.chapter ?: session.title)
        .putString(MediaMetadata.METADATA_KEY_ALBUM, session.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, if (session.chapter != null) session.title else null)
        .apply { if (art != null) putBitmap(MediaMetadata.METADATA_KEY_ART, art) }
        .build()
    )
    mediaSession.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
            PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP
        )
        .setState(
          if (session.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          1f,
        )
        .build()
    )

    val notification = notification(session, art)
    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
  }

  private fun notification(session: Session, art: Bitmap?): Notification {
    val open = PendingIntent.getActivity(
      this,
      0,
      packageManager.getLaunchIntentForPackage(packageName)
        ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    fun action(icon: Int, title: Int, name: String, code: Int) = Notification.Action.Builder(
      Icon.createWithResource(this, icon),
      getString(title),
      PendingIntent.getService(
        this,
        code,
        Intent(this, PlaybackService::class.java)
          .setAction(ACTION_REMOTE)
          .putExtra(EXTRA_ACTION, name),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      ),
    ).build()

    return Notification.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(session.chapter ?: session.title)
      .setContentText(if (session.chapter != null) session.title else null)
      .setLargeIcon(art)
      .setContentIntent(open)
      .setOngoing(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .addAction(action(android.R.drawable.ic_media_previous, R.string.previous_sentence, "previous", 1))
      .addAction(
        if (session.playing) action(android.R.drawable.ic_media_pause, R.string.pause, "pause", 2)
        else action(android.R.drawable.ic_media_play, R.string.play, "play", 2)
      )
      .addAction(action(android.R.drawable.ic_media_next, R.string.next_sentence, "next", 3))
      .addAction(action(android.R.drawable.ic_menu_close_clear_cancel, R.string.stop, "stop", 4))
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
  }

  /** The book's cover, decoded once per book. */
  private fun coverBitmap(path: String?): Bitmap? {
    if (path == null) return null
    cover?.let { (cached, bitmap) -> if (cached == path) return bitmap }
    val bitmap = try {
      BitmapFactory.decodeFile(path)
    } catch (e: Exception) {
      null
    }
    cover = path to bitmap
    return bitmap
  }

  private fun requestFocus() {
    if (focus != null) return
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      // Speech can't be ducked into the background usefully: pause instead.
      .setWillPauseWhenDucked(true)
      .setOnAudioFocusChangeListener { change ->
        when (change) {
          AudioManager.AUDIOFOCUS_LOSS -> {
            pausedForFocus = false
            abandonFocus()
            remote("pause")
          }
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
          AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
            if (session?.playing == true) {
              pausedForFocus = true
              remote("pause")
            }
          }
          AudioManager.AUDIOFOCUS_GAIN -> {
            if (pausedForFocus) remote("play")
            pausedForFocus = false
          }
        }
      }
      .build()
    if (audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      focus = request
    }
  }

  private fun abandonFocus() {
    focus?.let { audio.abandonAudioFocusRequest(it) }
    focus = null
  }
}
