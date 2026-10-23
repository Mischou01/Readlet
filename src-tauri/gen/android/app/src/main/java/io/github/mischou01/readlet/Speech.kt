package io.github.mischou01.readlet

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import java.util.Locale

/**
 * Read-aloud through the system's text-to-speech engine.
 *
 * Each sentence arrives as an utterance of its own, tagged with the mark the UI uses to find it
 * (see src-tauri/src/tts/segments.rs). The engine reports each utterance as it starts, which
 * becomes a `mark` event, and the last one finishing becomes `end`. Utterance ids are
 * "<message>:<index>", so events from a message that was replaced are still told apart.
 *
 * All state is touched on the main thread: engine callbacks arrive on other threads and are
 * posted there.
 */
class Speech(private val context: Context, private val emit: (JSObject) -> Unit) {
  private val main = Handler(Looper.getMainLooper())
  private var engine: TextToSpeech? = null
  private var ready = false
  /** Work waiting for the engine to start. */
  private val waiting = mutableListOf<Pair<(TextToSpeech) -> Unit, (String) -> Unit>>()

  /** The mark of each queued utterance, by id. */
  private val marks = HashMap<String, String>()
  /** The id of each message's last utterance, whose end ends the message. */
  private val lastUtterance = HashMap<Long, String>()
  private val begun = HashSet<Long>()
  private val canceled = HashSet<Long>()

  private fun withEngine(work: (TextToSpeech) -> Unit, onError: (String) -> Unit) {
    main.post {
      val current = engine
      if (current != null && ready) return@post work(current)
      waiting.add(work to onError)
      if (current != null) return@post
      engine = TextToSpeech(context) { status -> main.post { started(status) } }
    }
  }

  private fun started(status: Int) {
    val tts = engine ?: return
    val pending = waiting.toList()
    waiting.clear()
    if (status != TextToSpeech.SUCCESS) {
      tts.shutdown()
      engine = null
      val message = "No text-to-speech engine is working on this phone. Install or enable one " +
        "(for example Speech Services by Google, or RHVoice or eSpeak NG from F-Droid) in " +
        "Settings › Accessibility › Text-to-speech, then try again."
      pending.forEach { (_, onError) -> onError(message) }
      return
    }
    ready = true
    tts.setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    )
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String) {
        main.post { onUtteranceStart(id) }
      }

      override fun onDone(id: String) {
        main.post { onUtteranceDone(id) }
      }

      override fun onStop(id: String, interrupted: Boolean) {
        main.post { onUtteranceStopped(id) }
      }

      @Deprecated("Deprecated in Java")
      override fun onError(id: String) {
        main.post { onUtteranceError(id, TextToSpeech.ERROR) }
      }

      override fun onError(id: String, errorCode: Int) {
        main.post { onUtteranceError(id, errorCode) }
      }
    })
    pending.forEach { (work, _) -> work(tts) }
  }

  fun voices(onVoices: (JSArray) -> Unit, onError: (String) -> Unit) {
    withEngine({ tts ->
      val usable = (tts.voices ?: emptySet<Voice>())
        .filterNot { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED in it.features }
        // Voices that work offline first, then by language and name.
        .sortedWith(compareBy({ it.isNetworkConnectionRequired }, { it.locale.toLanguageTag() }, { it.name }))
      val list = JSArray()
      for (voice in usable) {
        list.put(JSObject().apply {
          put("name", voice.name)
          put("language", voice.locale.toLanguageTag())
          put("variant", if (voice.isNetworkConnectionRequired) "network" else "")
        })
      }
      onVoices(list)
    }, onError)
  }

  fun speak(args: SpeakArgs, onQueued: () -> Unit, onError: (String) -> Unit) {
    withEngine({ tts ->
      chooseVoice(tts, args.voice, args.language)
      tts.setSpeechRate(args.rate.toFloat())
      val message = args.message
      // Only the newest message matters; forget the bookkeeping of earlier ones.
      marks.clear()
      lastUtterance.clear()
      begun.clear()
      canceled.clear()
      if (args.utterances.isEmpty()) {
        // Nothing to say, but the UI waits for an end before moving on.
        val id = "$message:0"
        lastUtterance[message] = id
        tts.playSilentUtterance(1, TextToSpeech.QUEUE_FLUSH, id)
      } else {
        args.utterances.forEachIndexed { index, utterance ->
          val id = "$message:$index"
          utterance.mark?.let { marks[id] = it }
          val mode = if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
          tts.speak(utterance.text, mode, null, id)
          lastUtterance[message] = id
        }
      }
      onQueued()
    }, onError)
  }

  /**
   * A voice by name if it's installed; otherwise the engine's default voice for the language (or
   * for the phone's language).
   */
  private fun chooseVoice(tts: TextToSpeech, name: String?, language: String?) {
    val voice = name?.let { wanted -> tts.voices?.firstOrNull { it.name == wanted } }
    if (voice != null) {
      tts.voice = voice
      return
    }
    val locale = language?.takeIf { it.isNotBlank() }?.let { Locale.forLanguageTag(it) }
    if (locale == null || tts.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) {
      tts.setLanguage(Locale.getDefault())
    }
  }

  fun stop() {
    main.post { engine?.stop() }
  }

  fun shutdown() {
    main.post {
      engine?.shutdown()
      engine = null
      ready = false
    }
  }

  private fun messageOf(id: String): Long? = id.substringBefore(':').toLongOrNull()

  private fun event(kind: String, message: Long) = JSObject().apply {
    put("type", "tts")
    put("kind", kind)
    put("message", message)
  }

  private fun onUtteranceStart(id: String) {
    val message = messageOf(id) ?: return
    if (begun.add(message)) emit(event("begin", message))
    marks[id]?.let { mark -> emit(event("mark", message).apply { put("mark", mark) }) }
  }

  private fun onUtteranceDone(id: String) {
    val message = messageOf(id) ?: return
    if (lastUtterance[message] == id) emit(event("end", message))
  }

  private fun onUtteranceStopped(id: String) {
    val message = messageOf(id) ?: return
    if (canceled.add(message)) emit(event("canceled", message))
  }

  private fun onUtteranceError(id: String, code: Int) {
    val message = messageOf(id) ?: return
    val reason = when (code) {
      TextToSpeech.ERROR_NETWORK, TextToSpeech.ERROR_NETWORK_TIMEOUT ->
        "This voice needs an internet connection. Choose a voice that works offline."
      TextToSpeech.ERROR_NOT_INSTALLED_YET ->
        "This voice is still downloading. Try again in a moment, or choose another voice."
      else -> "The text-to-speech engine couldn't read this passage (error $code)."
    }
    emit(event("error", message).apply { put("error", reason) })
  }
}
