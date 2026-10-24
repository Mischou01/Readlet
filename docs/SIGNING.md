# Signing the Android APK

Android only updates an app with an APK signed by the same key. Create a key once and keep it:

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore readlet.keystore -alias readlet \
  -keyalg RSA -keysize 4096 -validity 10000
```

For CI, set the repository secrets `ANDROID_KEYSTORE` (`base64 -w0 readlet.keystore`) and
`ANDROID_KEYSTORE_PASSWORD`. Without them the APK is built but not published.

For local release builds, create `src-tauri/gen/android/keystore.properties` (git-ignored):

```properties
storeFile=/path/to/readlet.keystore
keyAlias=readlet
password=YOUR_PASSWORD_HERE
```
