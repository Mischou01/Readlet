package io.github.mischou01.readlet

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * What Readlet's home-screen widgets show, and what they share. A widget draws without the app
 * running, so the app hands over a snapshot whenever its reading data changes (the reader saving
 * its place, a session ending, the goal changing; see `updateWidgets` in ReadletPlugin), and the
 * widgets draw from that. A tap opens the app at the book, or at the stats.
 */
object Widgets {
  private const val SNAPSHOT_FILE = "widgets.json"
  private const val ACTION_OPEN = "io.github.mischou01.readlet.OPEN"
  const val ACTION_NEW_DAY = "io.github.mischou01.readlet.WIDGETS_NEW_DAY"

  class Palette(val light: IntArray, val dark: IntArray, val accent: Int, val accentDark: Int)

  class Book(
    val fingerprint: String,
    val title: String,
    val author: String?,
    val chapter: String?,
    val fraction: Double,
    /** At the reader's own pace; null until the book has been opened on this phone. */
    val minutesLeft: Double?,
    val coverPath: String?,
    val palette: Palette,
  )

  /** Today's reading as it stood on `day` (the snapshot's day). */
  class Goal(val minutes: Int, val target: Int, val streak: Int, val readToday: Boolean)

  class Snapshot(val day: LocalDate, val current: Book?, val shelf: List<Book>, val goal: Goal)

  // -- The snapshot -------------------------------------------------------------------------------

  /** Keeps the app's snapshot (JSON, as `widgetSnapshot` in src/state/widgets.ts builds it). */
  fun save(context: Context, json: String) {
    File(context.filesDir, SNAPSHOT_FILE).writeText(json)
    refresh(context)
  }

  fun load(context: Context): Snapshot? = try {
    parse(JSONObject(File(context.filesDir, SNAPSHOT_FILE).readText()))
  } catch (e: Exception) {
    null
  }

  private fun parse(json: JSONObject): Snapshot {
    val shelf = json.optJSONArray("shelf") ?: JSONArray()
    val goal = json.getJSONObject("goal")
    return Snapshot(
      day = LocalDate.parse(json.getString("day")),
      current = json.optJSONObject("current")?.let(::parseBook),
      shelf = (0 until shelf.length()).map { parseBook(shelf.getJSONObject(it)) },
      goal = Goal(
        minutes = goal.getInt("minutes"),
        target = goal.getInt("target"),
        streak = goal.getInt("streak"),
        readToday = goal.getBoolean("readToday"),
      ),
    )
  }

  private fun parseBook(json: JSONObject): Book {
    val palette = json.getJSONObject("palette")
    fun colors(name: String) = palette.getJSONArray(name).let { list ->
      IntArray(list.length()) { Color.parseColor(list.getString(it)) }
    }
    return Book(
      fingerprint = json.getString("fingerprint"),
      title = json.getString("title"),
      author = json.optString("author").takeIf { it.isNotEmpty() },
      chapter = json.optString("chapter").takeIf { it.isNotEmpty() },
      fraction = json.optDouble("fraction", 0.0).coerceIn(0.0, 1.0),
      minutesLeft = if (json.isNull("minutesLeft")) null else json.optDouble("minutesLeft"),
      coverPath = json.optString("coverPath").takeIf { it.isNotEmpty() },
      palette = Palette(
        light = colors("light"),
        dark = colors("dark"),
        accent = Color.parseColor(palette.getString("accent")),
        accentDark = Color.parseColor(palette.getString("accentDark")),
      ),
    )
  }

  /**
   * The goal as it stands `today`. The snapshot was written on its own day: the next day starts
   * at nothing, with the streak still alive if the reader read on the snapshot's day; after that,
   * the streak is broken.
   */
  fun goalOn(snapshot: Snapshot, today: LocalDate): Goal {
    val goal = snapshot.goal
    return when {
      today == snapshot.day -> goal
      today == snapshot.day.plusDays(1) ->
        Goal(0, goal.target, if (goal.readToday) goal.streak else 0, false)
      else -> Goal(0, goal.target, 0, false)
    }
  }

  // -- Drawing ------------------------------------------------------------------------------------

  /** Redraws every Readlet widget on the home screen. */
  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    fun ids(provider: Class<*>) = manager.getAppWidgetIds(ComponentName(context, provider))
    ContinueReadingWidget.draw(context, manager, ids(ContinueReadingWidget::class.java))
    GoalWidget.draw(context, manager, ids(GoalWidget::class.java))
    ShelfWidget.draw(context, manager, ids(ShelfWidget::class.java))
  }

  /** A widget's size in dp, as the launcher reports it: the width in portrait, and its height. */
  fun size(options: Bundle): Pair<Int, Int> = Pair(
    options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH),
    options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT),
  )

  private fun isNight(context: Context) =
    context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
      Configuration.UI_MODE_NIGHT_YES

  /**
   * Tints a view in the book's colours. From Android 12 the launcher picks the day or night colour
   * itself as the system switches; before that, it's the one for now until the next redraw.
   */
  private fun RemoteViews.tint(context: Context, id: Int, day: Int, night: Int) {
    if (Build.VERSION.SDK_INT >= 31) setColorInt(id, "setColorFilter", day, night)
    else setInt(id, "setColorFilter", if (isNight(context)) night else day)
  }

  private fun RemoteViews.tintProgress(id: Int, day: Int, night: Int) {
    // Before Android 12 a progress bar keeps the theme's accent.
    if (Build.VERSION.SDK_INT >= 31) {
      setColorStateList(
        id,
        "setProgressTintList",
        ColorStateList.valueOf(day),
        ColorStateList.valueOf(night),
      )
    }
  }

  /**
   * The book's aura behind a widget, as on Readlet's toolbar and sheets: its cover's colours as
   * a soft glow from either side (`glowStart` and `glowEnd` in the layout).
   */
  fun paintAura(context: Context, views: RemoteViews, palette: Palette?) {
    val p = palette ?: return
    views.tint(context, R.id.glowStart, p.light[0], p.dark[0])
    views.tint(context, R.id.glowEnd, p.light[1], p.dark[1])
  }

  /** An icon in the book's accent. */
  fun paintAccent(context: Context, views: RemoteViews, id: Int, palette: Palette?) {
    palette?.let { views.tint(context, id, it.accent, it.accentDark) }
  }

  /** A progress bar (or ring) in the book's accent. */
  fun paintProgress(views: RemoteViews, id: Int, palette: Palette?, fraction: Double) {
    views.setProgressBar(id, 1000, (fraction * 1000).roundToInt(), false)
    palette?.let { views.tintProgress(id, it.accent, it.accentDark) }
  }

  /**
   * A book's cover, scaled down to `heightDp` (covers are kept at up to 720 pixels high, and a
   * widget's pictures all travel to the launcher in one message of about a megabyte).
   */
  fun cover(context: Context, path: String?, heightDp: Int): Bitmap? {
    if (path == null || heightDp <= 0) return null
    // Twice the dp size at most: sharp enough on any screen, small enough to send.
    val density = context.resources.displayMetrics.density.coerceAtMost(2f)
    val height = (heightDp * density).roundToInt()
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outHeight <= 0 || bounds.outWidth <= 0) return null
    var sample = 1
    while (bounds.outHeight / (sample * 2) >= height) sample *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.RGB_565
    }
    val bitmap = BitmapFactory.decodeFile(path, options) ?: return null
    if (bitmap.height <= height) return bitmap
    val width = (bitmap.width * height.toFloat() / bitmap.height).roundToInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(bitmap, width, height, true).also {
      if (it !== bitmap) bitmap.recycle()
    }
  }

  /** "34%" */
  fun percent(fraction: Double): String = "${(fraction * 100).roundToInt()}%"

  /** "9 min left in chapter", as the reader's footer says it. */
  fun timeLeft(minutes: Double): String {
    val rounded = minutes.roundToInt()
    return when {
      rounded < 1 -> "Less than a minute left in chapter"
      rounded < 60 -> "$rounded min left in chapter"
      else -> "${rounded / 60} h ${rounded % 60} min left in chapter"
    }
  }

  // -- Opening the app ----------------------------------------------------------------------------

  /** Opens the app at a book. */
  fun openBook(context: Context, fingerprint: String): PendingIntent =
    open(context, "book/$fingerprint")

  fun openStats(context: Context): PendingIntent = open(context, "stats")

  /** Opens the app where it was. */
  fun openApp(context: Context): PendingIntent = open(context, "app")

  private fun open(context: Context, target: String): PendingIntent {
    val intent = Intent(context, MainActivity::class.java)
      .setAction(ACTION_OPEN)
      // The address keeps each target's intent apart, so a tap on one cover doesn't open another.
      .setData(Uri.parse("readlet://open/$target"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      target.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** What an intent from a widget asks the app to show: "book:<fingerprint>" or "stats". */
  fun openTarget(intent: Intent?): String? {
    if (intent?.action != ACTION_OPEN) return null
    val path = intent.data?.path?.trim('/') ?: return null
    return when {
      path.startsWith("book/") -> "book:${path.removePrefix("book/")}"
      path == "stats" -> "stats"
      else -> null
    }
  }

  // -- A new day ----------------------------------------------------------------------------------

  /**
   * Redraws the goal widgets just after midnight, when today's minutes start again. The alarm is
   * inexact, so the phone may run it a little late to save power.
   */
  fun scheduleNewDay(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val zone = ZoneId.systemDefault()
    val nextMidnight = LocalDate.now(zone).plusDays(1).atStartOfDay().plusMinutes(1)
    val at = nextMidnight.atZone(zone).toInstant().toEpochMilli()
    val intent = Intent(context, GoalWidget::class.java).setAction(ACTION_NEW_DAY)
    val pending = PendingIntent.getBroadcast(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    alarms.set(AlarmManager.RTC, at, pending)
  }

  fun today(): LocalDate = LocalDate.now()
}
