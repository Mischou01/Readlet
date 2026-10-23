package io.github.mischou01.readlet

import android.graphics.Rect
import android.os.Bundle
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
