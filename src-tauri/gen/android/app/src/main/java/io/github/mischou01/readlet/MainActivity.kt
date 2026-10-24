package io.github.mischou01.readlet

import android.graphics.Rect
import android.os.Bundle
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
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
   * so the system's floating Copy / Share / Select all toolbar would cover it. It's kept for text
   * fields, where cut and paste matter.
   */
  override fun onWindowStartingActionMode(callback: ActionMode.Callback, type: Int): ActionMode? {
    if (type == ActionMode.TYPE_FLOATING && callback is ActionMode.Callback2) {
      return super.onWindowStartingActionMode(QuietSelectionMenu(callback), type)
    }
    return super.onWindowStartingActionMode(callback, type)
  }

  private class QuietSelectionMenu(private val inner: ActionMode.Callback2) : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean =
      inner.onCreateActionMode(mode, menu).also { quiet(menu) }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean =
      inner.onPrepareActionMode(mode, menu).also { quiet(menu) }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean =
      inner.onActionItemClicked(mode, item)

    override fun onDestroyActionMode(mode: ActionMode) = inner.onDestroyActionMode(mode)

    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) =
      inner.onGetContentRect(mode, view, outRect)

    /** Empties the menu unless the selection is editable (it offers cut or paste). */
    private fun quiet(menu: Menu) {
      val editable = menu.findItem(android.R.id.cut) != null || menu.findItem(android.R.id.paste) != null
      if (!editable) menu.clear()
    }
  }
}
