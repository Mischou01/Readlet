package io.github.mischou01.readlet

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small secrets (a sync service's token), encrypted with a key that lives in Android's keystore
 * and never leaves it. Only the ciphertext is stored, in the app's private preferences. A backup
 * restored onto another phone brings the ciphertext without the key, so there the token reads as
 * missing and the reader connects again.
 */
class Secrets(context: Context) {
  private val prefs = context.getSharedPreferences("secrets", Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  fun get(name: String): String? {
    val stored = prefs.getString(name, null) ?: return null
    return try {
      val sealed = Base64.decode(stored, Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
      String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES), Charsets.UTF_8)
    } catch (e: Exception) {
      // The key is gone or changed: the secret can't be read any more.
      null
    }
  }

  fun set(name: String, value: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(name, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
  }

  fun delete(name: String) {
    prefs.edit().remove(name).apply()
  }

  companion object {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "readlet-secrets"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
  }
}
