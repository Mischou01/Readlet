package io.github.mischou01.readlet

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.UUID
import kotlin.concurrent.thread

@InvokeArg
class EventHandlerArgs {
  lateinit var handler: Channel
}

@InvokeArg
class UtteranceArg {
  var mark: String? = null
  var text: String = ""
}

@InvokeArg
class SpeakArgs {
  var message: Long = 0
  var utterances: Array<UtteranceArg> = arrayOf()
  var rate: Double = 1.0
  var voice: String? = null
  var language: String? = null
}

@InvokeArg
class SessionArgs {
  var title: String = ""
  var chapter: String? = null
  var coverPath: String? = null
  var playing: Boolean = false
}

@InvokeArg
class SystemBarsArgs {
  var dark: Boolean = false
  var hidden: Boolean = false
}

@InvokeArg
class SecretArgs {
  var name: String = ""
  var value: String? = null
}

@InvokeArg
class ReaderControlsArgs {
  var keepScreenOn: Boolean = false
  var volumeKeys: Boolean = false
}

/**
 * What only Android can do for Readlet, called from Rust (src-tauri/src/android): read-aloud
 * through the system's text-to-speech, the media notification, "All files access", the system
 * pickers, the system bars, the screen and volume keys while reading, and the keystore that keeps
 * the sync token. Everything it reports
 * goes through one channel to Rust, which forwards it to the UI.
 */
@TauriPlugin
class ReadletPlugin(private val activity: Activity) : Plugin(activity) {
  private var events: Channel? = null
  private val speech = Speech(activity.applicationContext) { emit(it) }
  private var insets = JSObject()
  private val secrets by lazy { Secrets(activity.applicationContext) }

  override fun load(webView: WebView) {
    // Show the window's background (the app's own background colour) until the page paints,
    // rather than a white flash.
    webView.setBackgroundColor(Color.TRANSPARENT)
    // WebView 136+ passes the system bars and cutouts to the page as `safe-area-inset-*`; older
    // ones don't, so the page also gets them from here. The stable values (ignoring whether the
    // bars are showing) keep the layout still when the reader hides the bars. WebView's own
    // handling, including resizing for the keyboard, carries on as normal.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val bars = windowInsets.getInsetsIgnoringVisibility(types)
      val density = view.resources.displayMetrics.density
      insets = JSObject().apply {
        put("top", bars.top / density)
        put("right", bars.right / density)
        put("bottom", bars.bottom / density)
        put("left", bars.left / density)
      }
      emit(JSObject(insets.toString()).apply { put("type", "insets") })
      ViewCompat.onApplyWindowInsets(view, windowInsets)
    }
    PlaybackService.onRemoteAction = { action ->
      emit(JSObject().apply {
        put("type", "remote")
        put("action", action)
      })
    }
    MainActivity.onPageKey = { direction ->
      emit(JSObject().apply {
        put("type", "pageKey")
        put("direction", direction)
      })
    }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    PlaybackService.onRemoteAction = null
    MainActivity.onPageKey = null
    MainActivity.volumeKeysTurnPages = false
    PlaybackService.stop(activity)
    speech.shutdown()
  }

  private fun emit(event: JSObject) {
    events?.send(event)
  }

  @Command
  fun setEventHandler(invoke: Invoke) {
    events = invoke.parseArgs(EventHandlerArgs::class.java).handler
    invoke.resolve()
  }

  // -- Read-aloud -------------------------------------------------------------------------------

  @Command
  fun voices(invoke: Invoke) {
    speech.voices(
      onVoices = { voices -> invoke.resolve(JSObject().apply { put("voices", voices) }) },
      onError = { invoke.reject(it) },
    )
  }

  @Command
  fun speak(invoke: Invoke) {
    val args = invoke.parseArgs(SpeakArgs::class.java)
    speech.speak(args, onQueued = { invoke.resolve() }, onError = { invoke.reject(it) })
  }

  @Command
  fun stopSpeaking(invoke: Invoke) {
    speech.stop()
    invoke.resolve()
  }

  @Command
  fun setPlaybackSession(invoke: Invoke) {
    val args = invoke.parseArgs(SessionArgs::class.java)
    // The service and its media session live on the main thread.
    activity.runOnUiThread {
      try {
        PlaybackService.update(
          activity,
          PlaybackService.Session(args.title, args.chapter, args.coverPath, args.playing),
        )
        invoke.resolve()
      } catch (e: Exception) {
        // Android refuses to start a foreground service from the background (Android 12+);
        // speaking still works, only without the lock-screen controls.
        invoke.reject("Couldn't show the read-aloud controls: ${e.message}")
      }
    }
  }

  @Command
  fun endPlaybackSession(invoke: Invoke) {
    activity.runOnUiThread {
      PlaybackService.stop(activity)
      invoke.resolve()
    }
  }

  // -- Files ------------------------------------------------------------------------------------

  private fun granted() = JSObject().apply { put("granted", Environment.isExternalStorageManager()) }

  @Command
  fun storageAccess(invoke: Invoke) {
    invoke.resolve(granted())
  }

  @Command
  fun requestStorageAccess(invoke: Invoke) {
    if (Environment.isExternalStorageManager()) {
      invoke.resolve(granted())
      return
    }
    val forThisApp = Intent(
      Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
      Uri.parse("package:${activity.packageName}"),
    )
    val intent = if (forThisApp.resolveActivity(activity.packageManager) != null) forThisApp
    else Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
    startActivityForResult(invoke, intent, "storageAccessReturned")
  }

  @ActivityCallback
  fun storageAccessReturned(invoke: Invoke, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
    invoke.resolve(granted())
  }

  @Command
  fun pickFolder(invoke: Invoke) {
    startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderPicked")
  }

  @ActivityCallback
  fun folderPicked(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().apply { put("path", null) })
      return
    }
    val path = folderPath(uri)
    if (path == null) {
      invoke.reject(
        "Readlet can only use folders on this phone's storage or its SD card. Choose one there."
      )
      return
    }
    invoke.resolve(JSObject().apply { put("path", path) })
  }

  /**
   * The file path of a folder picked in the system's picker. Readlet has "All files access", so
   * it reads the folder directly rather than through the picker's content URI.
   */
  private fun folderPath(tree: Uri): String? {
    if (tree.authority != "com.android.externalstorage.documents") return null
    val id = DocumentsContract.getTreeDocumentId(tree) ?: return null
    val volume = id.substringBefore(':')
    val relative = id.substringAfter(':', "")
    val root = if (volume.equals("primary", ignoreCase = true)) {
      Environment.getExternalStorageDirectory()
    } else {
      File("/storage", volume)
    }
    val folder = if (relative.isEmpty()) root else File(root, relative)
    return folder.takeIf { it.isDirectory }?.absolutePath
  }

  @Command
  fun pickBooks(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      // Book files often have no registered type; Rust skips anything that isn't a book.
      type = "*/*"
      putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }
    startActivityForResult(invoke, intent, "booksPicked")
  }

  @ActivityCallback
  fun booksPicked(invoke: Invoke, result: ActivityResult) {
    val data = result.data
    val uris = buildList {
      if (result.resultCode != Activity.RESULT_OK || data == null) return@buildList
      data.clipData?.let { clip -> for (i in 0 until clip.itemCount) add(clip.getItemAt(i).uri) }
      if (isEmpty()) data.data?.let { add(it) }
    }
    // Copying can take a moment for large files; keep it off the main thread.
    thread(name = "readlet-import") {
      try {
        val incoming = File(activity.cacheDir, "incoming")
        incoming.deleteRecursively()
        val paths = JSArray()
        for (uri in uris) paths.put(copyToCache(uri, incoming).absolutePath)
        invoke.resolve(JSObject().apply { put("paths", paths) })
      } catch (e: Exception) {
        invoke.reject("Couldn't read the books: ${e.message}")
      }
    }
  }

  /** Copies a picked document into the cache under its own name (Rust names the copy after it). */
  private fun copyToCache(uri: Uri, dir: File): File {
    val resolver = activity.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
      ?.replace('/', '_')
      ?.takeIf { it.isNotBlank() && !it.startsWith(".") }
      ?: "book"
    val target = File(File(dir, UUID.randomUUID().toString()).apply { mkdirs() }, name)
    val input = resolver.openInputStream(uri) ?: error("the file couldn't be opened")
    input.use { source -> target.outputStream().use { source.copyTo(it) } }
    return target
  }

  // -- Window -----------------------------------------------------------------------------------

  @Command
  fun insets(invoke: Invoke) {
    invoke.resolve(insets)
  }

  @Command
  fun setSystemBars(invoke: Invoke) {
    val args = invoke.parseArgs(SystemBarsArgs::class.java)
    activity.runOnUiThread {
      val window = activity.window
      val controller = WindowCompat.getInsetsController(window, window.decorView)
      controller.isAppearanceLightStatusBars = !args.dark
      controller.isAppearanceLightNavigationBars = !args.dark
      if (args.hidden) {
        controller.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
      }
      invoke.resolve()
    }
  }

  /**
   * While reading: keeps the screen from dimming and locking (the reader turns this off again
   * after a while without a page turn or a tap), and lets the volume keys turn pages.
   */
  @Command
  fun setReaderControls(invoke: Invoke) {
    val args = invoke.parseArgs(ReaderControlsArgs::class.java)
    MainActivity.volumeKeysTurnPages = args.volumeKeys
    activity.runOnUiThread {
      if (args.keepScreenOn) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      } else {
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
      invoke.resolve()
    }
  }

  // -- Secrets ----------------------------------------------------------------------------------

  @Command
  fun getSecret(invoke: Invoke) {
    val args = invoke.parseArgs(SecretArgs::class.java)
    invoke.resolve(JSObject().apply { put("value", secrets.get(args.name)) })
  }

  @Command
  fun setSecret(invoke: Invoke) {
    val args = invoke.parseArgs(SecretArgs::class.java)
    try {
      secrets.set(args.name, args.value ?: "")
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "The keystore refused the secret")
    }
  }

  @Command
  fun deleteSecret(invoke: Invoke) {
    secrets.delete(invoke.parseArgs(SecretArgs::class.java).name)
    invoke.resolve()
  }

  @Command
  fun moveToBackground(invoke: Invoke) {
    activity.moveTaskToBack(true)
    invoke.resolve()
  }
}
