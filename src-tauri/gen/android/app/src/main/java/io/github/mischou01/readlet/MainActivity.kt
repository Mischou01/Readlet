package io.github.mischou01.readlet

import android.os.Bundle
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuInflater
import android.view.View
import android.widget.PopupMenu
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  companion object {
    /** The reader is open and turns pages with the volume keys (a setting); see ReadletPlugin. */
    @Volatile
    var volumeKeysTurnPages = false

    /** Receives "next" or "previous" when a volume key turns the page. */
    var onPageKey: ((String) -> Unit)? = null
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * While the reader is open, the volume keys can turn pages instead of changing the volume:
   * down goes forward, up goes back. Holding a key turns one page, not a stream of them. Both the
   * press and the release are consumed, or the system would still show its volume slider.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val direction = when (event.keyCode) {
      KeyEvent.KEYCODE_VOLUME_DOWN -> "next"
      KeyEvent.KEYCODE_VOLUME_UP -> "previous"
      else -> null
    }
    if (direction != null && volumeKeysTurnPages) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        onPageKey?.invoke(direction)
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  /**
   * Selecting text in a book opens Readlet's own bar (highlight, note, define, copy, read aloud),
   * so the system's floating Copy / Share / Select all toolbar would only cover it. The WebView
   * gets a stand-in action mode that shows nothing instead. Text fields keep the real one, for cut
   * and paste.
   *
   * The stand-in has to be returned from here: Activity's own implementation returns null for
   * floating modes, and the window then builds the toolbar from the original callback, so
   * wrapping the callback and passing it on changes nothing.
   */
  override fun onWindowStartingActionMode(callback: ActionMode.Callback, type: Int): ActionMode? {
    if (type == ActionMode.TYPE_FLOATING && currentFocus?.onCheckIsTextEditor() != true) {
      val mode = HiddenActionMode(callback, window.decorView)
      return if (callback.onCreateActionMode(mode, mode.menu)) mode else null
    }
    return super.onWindowStartingActionMode(callback, type)
  }

  /**
   * A floating action mode without a toolbar. Finishing it reports back to the WebView as the real
   * one would, so the selection and the window's bookkeeping end with it.
   */
  private class HiddenActionMode(
    private val callback: ActionMode.Callback,
    private val anchor: View,
  ) : ActionMode() {
    private val emptyMenu: Menu by lazy { PopupMenu(anchor.context, anchor).menu }
    private var finished = false

    init {
      type = TYPE_FLOATING
    }

    override fun finish() {
      if (finished) return
      finished = true
      callback.onDestroyActionMode(this)
    }

    override fun getMenu(): Menu = emptyMenu
    override fun getMenuInflater(): MenuInflater = MenuInflater(anchor.context)
    override fun invalidate() {}
    override fun setTitle(title: CharSequence?) {}
    override fun setTitle(resId: Int) {}
    override fun setSubtitle(subtitle: CharSequence?) {}
    override fun setSubtitle(resId: Int) {}
    override fun setCustomView(view: View?) {}
    override fun getTitle(): CharSequence? = null
    override fun getSubtitle(): CharSequence? = null
    override fun getCustomView(): View? = null
  }
}
