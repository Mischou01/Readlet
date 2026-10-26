package io.github.mischou01.readlet

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews

/** Draws each widget from the app's snapshot (see Widgets), on any change and when resized. */
abstract class ReadletWidget : AppWidgetProvider() {
  abstract fun views(context: Context, snapshot: Widgets.Snapshot?, options: Bundle): RemoteViews

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    drawAll(context, manager, ids)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle,
  ) {
    drawAll(context, manager, intArrayOf(id))
  }

  fun drawAll(context: Context, manager: AppWidgetManager, ids: IntArray) {
    if (ids.isEmpty()) return
    val snapshot = Widgets.load(context)
    for (id in ids) {
      manager.updateAppWidget(id, views(context, snapshot, manager.getAppWidgetOptions(id)))
    }
  }
}

/**
 * The book being read: its cover, title, chapter and progress, and the time left in the chapter.
 * Narrow, it's the cover over a ring of progress. A tap opens the book where it was left.
 */
class ContinueReadingWidget : ReadletWidget() {
  companion object {
    /** Narrower than this (dp), there's only room for the cover. */
    private const val WIDE_DP = 220

    fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) =
      ContinueReadingWidget().drawAll(context, manager, ids)
  }

  override fun views(context: Context, snapshot: Widgets.Snapshot?, options: Bundle): RemoteViews {
    val (width, height) = Widgets.size(options)
    val book = snapshot?.current
    if (book == null) {
      return RemoteViews(context.packageName, R.layout.widget_empty).apply {
        setTextViewText(R.id.message, context.getString(R.string.widget_continue_empty))
        setOnClickPendingIntent(R.id.root, Widgets.openApp(context))
      }
    }
    val wide = width >= WIDE_DP
    val views = RemoteViews(
      context.packageName,
      if (wide) R.layout.widget_continue else R.layout.widget_continue_small,
    )
    Widgets.paintAura(context, views, book.palette)
    // Wide, the cover fills the height inside the padding; narrow, it shares it with the ring.
    val coverHeight = if (wide) height - 28 else height - 64
    val cover = Widgets.cover(context, book.coverPath, coverHeight)
    if (cover != null) views.setImageViewBitmap(R.id.cover, cover)
    views.setViewVisibility(R.id.cover, if (cover != null) View.VISIBLE else View.GONE)
    views.setContentDescription(R.id.cover, book.title)
    Widgets.paintProgress(views, R.id.progress, book.palette, book.fraction)
    if (wide) {
      views.setTextViewText(R.id.title, book.title)
      views.setTextViewText(R.id.byline, book.chapter ?: book.author ?: "")
      val left = book.minutesLeft?.let(Widgets::timeLeft)
      views.setTextViewText(
        R.id.status,
        if (left != null) "${Widgets.percent(book.fraction)} · $left" else Widgets.percent(book.fraction),
      )
    } else {
      views.setTextViewText(R.id.status, Widgets.percent(book.fraction))
      // Without a cover the title stands in for it.
      views.setTextViewText(R.id.title, book.title)
      views.setViewVisibility(R.id.title, if (cover == null) View.VISIBLE else View.GONE)
    }
    views.setOnClickPendingIntent(R.id.root, Widgets.openBook(context, book.fingerprint))
    return views
  }
}

/** Today's reading against the daily goal, as a ring, and the streak. A tap opens the stats. */
class GoalWidget : ReadletWidget() {
  companion object {
    fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) =
      GoalWidget().drawAll(context, manager, ids)
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Widgets.ACTION_NEW_DAY) Widgets.refresh(context)
    else super.onReceive(context, intent)
  }

  override fun views(context: Context, snapshot: Widgets.Snapshot?, options: Bundle): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_goal)
    views.setOnClickPendingIntent(R.id.root, Widgets.openStats(context))
    if (snapshot == null) {
      views.setTextViewText(R.id.minutes, "0")
      views.setTextViewText(R.id.summary, context.getString(R.string.widget_goal_empty))
      views.setTextViewText(R.id.streak, "")
      views.setViewVisibility(R.id.flame, View.GONE)
      return views
    }
    val palette = snapshot.current?.palette
    Widgets.paintAura(context, views, palette)
    val goal = Widgets.goalOn(snapshot, Widgets.today())
    val target = goal.target.coerceAtLeast(1)
    Widgets.paintProgress(views, R.id.ring, palette, (goal.minutes.toDouble() / target).coerceAtMost(1.0))
    views.setTextViewText(R.id.minutes, goal.minutes.toString())
    views.setTextViewText(
      R.id.summary,
      if (goal.minutes >= target) context.getString(R.string.widget_goal_done)
      else context.getString(R.string.widget_goal_progress, target),
    )
    views.setTextViewText(
      R.id.streak,
      if (goal.streak > 0) context.resources.getQuantityString(R.plurals.widget_streak, goal.streak, goal.streak)
      else context.getString(R.string.widget_streak_none),
    )
    views.setViewVisibility(R.id.flame, if (goal.streak > 0) View.VISIBLE else View.GONE)
    Widgets.paintAccent(context, views, R.id.flame, palette)
    // Today's minutes start again at midnight.
    Widgets.scheduleNewDay(context)
    return views
  }
}

/** The books being read, most recent first, as covers with their progress. A tap opens one. */
class ShelfWidget : ReadletWidget() {
  companion object {
    /** The cover slots in the layout. */
    private val SLOTS = intArrayOf(R.id.slot0, R.id.slot1, R.id.slot2, R.id.slot3, R.id.slot4, R.id.slot5)
    private val COVERS = intArrayOf(R.id.cover0, R.id.cover1, R.id.cover2, R.id.cover3, R.id.cover4, R.id.cover5)
    private val BARS = intArrayOf(R.id.progress0, R.id.progress1, R.id.progress2, R.id.progress3, R.id.progress4, R.id.progress5)
    /** Space a cover takes beside its own width (dp): the gap to the next one. */
    private const val GAP_DP = 10

    fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) =
      ShelfWidget().drawAll(context, manager, ids)
  }

  override fun views(context: Context, snapshot: Widgets.Snapshot?, options: Bundle): RemoteViews {
    val books = snapshot?.shelf.orEmpty()
    if (books.isEmpty()) {
      return RemoteViews(context.packageName, R.layout.widget_empty).apply {
        setTextViewText(R.id.message, context.getString(R.string.widget_shelf_empty))
        setOnClickPendingIntent(R.id.root, Widgets.openApp(context))
      }
    }
    val views = RemoteViews(context.packageName, R.layout.widget_shelf)
    Widgets.paintAura(context, views, books.first().palette)
    val (width, height) = Widgets.size(options)
    // Covers are about two thirds as wide as they're high; as many as fit the width.
    val coverHeight = (height - 36).coerceAtLeast(40)
    val coverWidth = coverHeight * 2 / 3
    val fits = ((width - 24 + GAP_DP) / (coverWidth + GAP_DP)).coerceIn(1, SLOTS.size)
    for (i in SLOTS.indices) {
      val book = books.getOrNull(i)
      if (book == null || i >= fits) {
        views.setViewVisibility(SLOTS[i], View.GONE)
        continue
      }
      views.setViewVisibility(SLOTS[i], View.VISIBLE)
      val cover = Widgets.cover(context, book.coverPath, coverHeight)
      if (cover != null) views.setImageViewBitmap(COVERS[i], cover)
      else views.setImageViewResource(COVERS[i], R.drawable.widget_cover_blank)
      views.setContentDescription(COVERS[i], book.title)
      Widgets.paintProgress(views, BARS[i], book.palette, book.fraction)
      views.setOnClickPendingIntent(SLOTS[i], Widgets.openBook(context, book.fingerprint))
    }
    return views
  }
}
