package app.triggertap.probe

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 접근성 오버레이 두 개: 조작 패널과 터치 위치 표식. 메인 스레드에서만 사용한다.
 * 표식은 편집 중에만 보이고, 탭을 보낼 때는 먼저 제거한다(주입 탭이 표식에 맞지 않도록).
 */
class OverlayController(private val service: ProbeService) {
    private val ctx: Context = ContextThemeWrapper(service, android.R.style.Theme_DeviceDefault)
    private val wm = service.getSystemService(WindowManager::class.java)
    private val density = service.resources.displayMetrics.density

    private var panel: LinearLayout? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private var statusView: TextView? = null
    private var pollButton: Button? = null
    private var tapNButton: Button? = null

    private var marker: MarkerView? = null
    private var markerParams: WindowManager.LayoutParams? = null
    private var editing = false

    @Volatile
    private var panelRect = Rect()

    val isPanelShown: Boolean get() = panel != null

    private fun dp(v: Int) = (v * density).toInt()

    private fun overlayParams(w: Int, h: Int) = WindowManager.LayoutParams(
        w, h,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    }

    // ------------------------------------------------------------------ 패널

    @SuppressLint("ClickableViewAccessibility")
    fun showPanel() {
        if (panel != null) return
        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(6), dp(8), dp(6))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(Color.argb(225, 24, 24, 28))
            }
        }
        val header = TextView(ctx).apply {
            text = "⠿ 트리거탭 진단 — 끌어서 이동"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        val status = TextView(ctx).apply {
            text = service.statusLine
            setTextColor(Color.rgb(160, 220, 255))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = android.graphics.Typeface.MONOSPACE
        }
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        fun button(label: String, onClick: () -> Unit) = Button(ctx).apply {
            text = label
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(8), dp(6), dp(8), dp(6))
            setOnClickListener { onClick() }
            row.addView(this, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(4) })
        }
        pollButton = button("감시 ▶") {
            if (service.isPolling) service.stopPolling() else service.startPolling()
        }
        button("표식") { toggleEditing() }
        button("탭1") { service.runTaps(1) }
        tapNButton = button("탭×${service.prefs.tapCount}") { service.runTaps(service.prefs.tapCount) }
        button("■") {
            service.stopPolling()
            service.cancelTaps()
        }
        button("닫기") { removeAll() }

        root.addView(header)
        root.addView(status)
        root.addView(row)

        val params = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
            x = dp(8)
            y = dp(80)
        }
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        header.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (e.rawX - downX).toInt()
                    params.y = startY + (e.rawY - downY).toInt()
                    wm.updateViewLayout(root, params)
                }
                MotionEvent.ACTION_UP -> root.post { capturePanelRect() }
            }
            true
        }
        root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> capturePanelRect() }

        wm.addView(root, params)
        panel = root
        panelParams = params
        statusView = status
        updateStatus(service.statusLine, service.isPolling)
    }

    private fun capturePanelRect() {
        val p = panel ?: return
        val loc = IntArray(2)
        p.getLocationOnScreen(loc)
        panelRect = Rect(loc[0], loc[1], loc[0] + p.width, loc[1] + p.height)
    }

    /** worker 스레드에서도 호출된다. */
    fun panelContains(x: Int, y: Int): Boolean = panelRect.contains(x, y)

    fun updateStatus(text: String, polling: Boolean) {
        statusView?.text = text
        pollButton?.text = if (polling) "감시 ■" else "감시 ▶"
        tapNButton?.text = "탭×${service.prefs.tapCount}"
    }

    fun removeAll() {
        editing = false
        hideMarker()
        panel?.let { runCatching { wm.removeView(it) } }
        panel = null
        panelParams = null
        statusView = null
        pollButton = null
        tapNButton = null
        panelRect = Rect()
    }

    // ------------------------------------------------------------------ 표식

    private fun toggleEditing() {
        editing = !editing
        if (editing) {
            showMarkerIfEditing()
            ProbeLog.add("표식 편집 켬: 원을 끌어 누를 지점에 두세요")
        } else {
            hideMarker()
            ProbeLog.add("표식 편집 끔. 저장된 좌표 ${service.prefs.point ?: "-"}")
        }
    }

    fun hideMarker() {
        marker?.let { runCatching { wm.removeView(it) } }
        marker = null
        markerParams = null
    }

    @SuppressLint("ClickableViewAccessibility")
    fun showMarkerIfEditing() {
        if (!editing || marker != null || panel == null) return
        val size = dp(56)
        val screen = wm.maximumWindowMetrics.bounds
        val (cx, cy) = service.prefs.point ?: (screen.centerX() to screen.centerY())
        val params = overlayParams(size, size).apply {
            x = cx - size / 2
            y = cy - size / 2
        }
        val view = MarkerView(ctx)
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        view.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (e.rawX - downX).toInt()
                    params.y = startY + (e.rawY - downY).toInt()
                    wm.updateViewLayout(v, params)
                }
                MotionEvent.ACTION_UP -> v.post { saveMarkerCenter() }
            }
            true
        }
        wm.addView(view, params)
        marker = view
        markerParams = params
        // 창 배치 좌표계가 화면 좌표와 어긋날 수 있으므로(상태 표시줄·컷아웃), 실제 위치를 재서 맞춘다.
        view.post {
            val loc = IntArray(2)
            view.getLocationOnScreen(loc)
            val dx = cx - (loc[0] + view.width / 2)
            val dy = cy - (loc[1] + view.height / 2)
            if (dx != 0 || dy != 0) {
                params.x += dx
                params.y += dy
                runCatching { wm.updateViewLayout(view, params) }
            }
        }
    }

    private fun saveMarkerCenter() {
        val v = marker ?: return
        val loc = IntArray(2)
        v.getLocationOnScreen(loc)
        val p = (loc[0] + v.width / 2) to (loc[1] + v.height / 2)
        service.prefs.point = p
        ProbeLog.add("좌표 저장: (${p.first}, ${p.second}) 화면 ${wm.maximumWindowMetrics.bounds.width()}x${wm.maximumWindowMetrics.bounds.height()}, 회전 ${service.getSystemService(android.hardware.display.DisplayManager::class.java).getDisplay(android.view.Display.DEFAULT_DISPLAY)?.rotation ?: "?"}")
    }

    private class MarkerView(context: Context) : View(context) {
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3 * context.resources.displayMetrics.density
            color = Color.rgb(255, 64, 64)
        }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(60, 255, 64, 64) }
        private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            strokeWidth = 1.5f * context.resources.displayMetrics.density
            color = Color.WHITE
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val r = minOf(cx, cy) - ring.strokeWidth
            canvas.drawCircle(cx, cy, r, fill)
            canvas.drawCircle(cx, cy, r, ring)
            canvas.drawLine(cx - r, cy, cx + r, cy, cross)
            canvas.drawLine(cx, cy - r, cx, cy + r, cross)
        }
    }
}
