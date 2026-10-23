package io.github.mischou01.readlet.android

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import androidx.activity.result.ActivityResult
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

private const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
private const val ACCESS_DENIED =
  "Readlet needs access to your files to read the books folder. Allow it, then try again."

/**
 * Chooses a folder with the system picker and answers with its filesystem path, so the Rust core
 * can read it like any other folder. That needs access to shared storage, which is asked for first.
 */
@TauriPlugin(
  permissions = [
    Permission(
      strings = [Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE],
      alias = "storage"
    )
  ]
)
class FoldersPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun pickFolder(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (Environment.isExternalStorageManager()) {
        openPicker(invoke)
      } else {
        val intent = Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:${activity.packageName}")
        )
        startActivityForResult(invoke, intent, "allFilesAccessResult")
      }
    } else if (getPermissionState("storage") == PermissionState.GRANTED) {
      openPicker(invoke)
    } else {
      requestPermissionForAlias("storage", invoke, "storagePermissionResult")
    }
  }

  // The settings screen always reports "cancelled", so ask Android what was decided.
  @ActivityCallback
  fun allFilesAccessResult(invoke: Invoke, result: ActivityResult) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
      openPicker(invoke)
    } else {
      invoke.reject(ACCESS_DENIED)
    }
  }

  @PermissionCallback
  fun storagePermissionResult(invoke: Invoke) {
    if (getPermissionState("storage") == PermissionState.GRANTED) openPicker(invoke)
    else invoke.reject(ACCESS_DENIED)
  }

  private fun openPicker(invoke: Invoke) {
    // Launched on the next frame: this can run inside the previous activity's result callback.
    activity.window.decorView.post {
      startActivityForResult(invoke, Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderResult")
    }
  }

  @ActivityCallback
  fun folderResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject())
      return
    }
    val path = pathOf(uri)
    if (path == null) {
      invoke.reject("Choose a folder on this device’s storage or SD card, not one from an online service.")
      return
    }
    invoke.resolve(JSObject().put("path", path))
  }

  /** "primary:Books/Fantasy" is /storage/emulated/0/Books/Fantasy; "1A2B-3C4D:Books" is on an SD card. */
  private fun pathOf(uri: Uri): String? {
    if (uri.authority != EXTERNAL_STORAGE) return null
    val id = DocumentsContract.getTreeDocumentId(uri)
    val volume = id.substringBefore(':')
    val relative = id.substringAfter(':', "")
    val root =
      if (volume.equals("primary", ignoreCase = true)) Environment.getExternalStorageDirectory()
      else File("/storage", volume)
    return if (relative.isEmpty()) root.path else File(root, relative).path
  }
}
