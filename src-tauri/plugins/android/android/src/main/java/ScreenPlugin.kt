package io.github.mischou01.readlet.android

import android.app.Activity
import android.content.Context
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.View
import android.view.Window
import android.webkit.WebView
import android.widget.PopupMenu
import androidx.appcompat.app.AppCompatActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class TextMenuArgs {
  var enabled: Boolean = false
}

/**
 * Fits Readlet to the screen. Tauri's activity draws edge to edge, under the status and navigation
 * bars, so this hides them (a swipe from the edge brings them back for a moment) and tells the UI
 * how far in to keep its controls: what the camera cutout covers, and any bar that's showing.
 *
 * It also keeps Android's floating text menu (copy, share, select all) away from text selected in
 * a book, where Readlet shows its own selection bar. Text fields get it back while focused.
 */
@TauriPlugin
class ScreenPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private var insets = Insets.NONE
  private var nativeTextMenu = false

  override fun load(webView: WebView) {
    this.webView = webView
    activity.runOnUiThread {
      hideSystemBars()
      ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
        val safe = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        if (safe != insets) {
          insets = safe
          publishInsets()
        }
        ViewCompat.onApplyWindowInsets(view, windowInsets)
      }
      ViewCompat.requestApplyInsets(webView)
      interceptTextMenus()
    }
  }

  // Android shows the bars again after another app or a system screen (like the folder picker).
  override fun onResume(activity: AppCompatActivity) {
    hideSystemBars()
  }

  @Command
  fun insets(invoke: Invoke) {
    invoke.resolve(insetsJson())
  }

  @Command
  fun setNativeTextMenu(invoke: Invoke) {
    nativeTextMenu = invoke.parseArgs(TextMenuArgs::class.java).enabled
    invoke.resolve()
  }

  private fun hideSystemBars() {
    val window = activity.window
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.systemBars())
    }
  }

  /** In CSS pixels, which are the screen's density-independent pixels at the webview's 100%. */
  private fun insetsJson(): JSObject {
    val density = activity.resources.displayMetrics.density
    return JSObject()
      .put("top", insets.top / density)
      .put("right", insets.right / density)
      .put("bottom", insets.bottom / density)
      .put("left", insets.left / density)
  }

  /** The UI asks for the insets when it starts; this tells it when they change later. */
  private fun publishInsets() {
    val json = insetsJson().toString()
    webView?.evaluateJavascript("window.__readletSetInsets && window.__readletSetInsets($json)", null)
  }

  /**
   * The webview asks the window to start its floating text menu. Answering with a menu that never
   * shows keeps the selection and its handles (a webview without a menu drops the selection).
   */
  private fun interceptTextMenus() {
    val window = activity.window
    val original = window.callback ?: return
    window.callback = object : Window.Callback by original {
      override fun onWindowStartingActionMode(callback: ActionMode.Callback, type: Int): ActionMode? =
        if (type == ActionMode.TYPE_FLOATING && !nativeTextMenu) {
          HiddenActionMode(activity, window.decorView, callback)
        } else {
          original.onWindowStartingActionMode(callback, type)
        }
    }
  }
}

/** A floating text menu that's never shown. Finishing it tells the webview, like a real one. */
private class HiddenActionMode(
  private val context: Context,
  anchor: View,
  private val callback: ActionMode.Callback
) : ActionMode() {
  private val menu = PopupMenu(context, anchor).menu
  private var finished = false

  init {
    type = TYPE_FLOATING
  }

  override fun setTitle(title: CharSequence?) {}
  override fun setTitle(resId: Int) {}
  override fun setSubtitle(subtitle: CharSequence?) {}
  override fun setSubtitle(resId: Int) {}
  override fun setCustomView(view: View?) {}
  override fun invalidate() {}
  override fun getMenu(): Menu = menu
  override fun getTitle(): CharSequence? = null
  override fun getSubtitle(): CharSequence? = null
  override fun getCustomView(): View? = null
  override fun getMenuInflater(): MenuInflater = MenuInflater(context)

  override fun finish() {
    if (finished) return
    finished = true
    callback.onDestroyActionMode(this)
  }
}
