package app.triggertap.testbench

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * 트리거탭 시험 대상. 보안(FLAG_SECURE) 전환과 실제로 받은 터치를 기록한다.
 *
 * - 같은 창에서 보안 켜기/끄기, 몇 초 뒤 켜기
 * - 몇 초 뒤 보안 화면을 "새 창"(새 Activity)으로 열기 — 대부분의 실제 앱이 이 방식
 * - 창 전체가 받은 터치(dispatchTouchEvent)와 탭 영역이 받은 터치(onTouch)를 따로 센다.
 *   둘이 다르면 뷰의 보안 필터가 주입 터치를 버린 것이다.
 */
class BenchActivity : Activity() {

    private object Touches {
        val lines = ArrayDeque<String>()
        var windowDowns = 0
        var areaDowns = 0
        var injected = 0
        var firstAt = 0L
        var lastAreaAt = 0L

        fun add(s: String) {
            lines.addLast(s)
            while (lines.size > 200) lines.removeFirst()
        }

        fun reset() {
            lines.clear(); windowDowns = 0; areaDowns = 0; injected = 0; firstAt = 0L; lastAreaAt = 0L
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var secure = false
    private var countdown: Runnable? = null
    private lateinit var status: TextView
    private lateinit var counter: TextView
    private lateinit var log: TextView
    private lateinit var area: FrameLayout

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    @SuppressLint("ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val openedSecure = intent.getBooleanExtra(EXTRA_SECURE, false)
        if (openedSecure) {
            secure = true
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(if (openedSecure) Color.rgb(60, 20, 20) else Color.rgb(20, 30, 45))
        }
        status = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(12), dp(8), dp(12), dp(4))
        }
        root.addView(status)

        fun row() = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(8), 0, dp(8), 0)
            root.addView(this)
        }
        fun Button.small(label: String, onClick: () -> Unit): Button {
            text = label
            isAllCaps = false
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setOnClickListener { onClick() }
            return this
        }
        val r1 = row()
        r1.addView(Button(this).small("보안 켜기/끄기") { cancelCountdown(); setSecure(!secure) })
        r1.addView(Button(this).small("3초 뒤 보안 켜기") { startCountdown(3) { setSecure(true) } })
        val r2 = row()
        r2.addView(Button(this).small("3초 뒤 보안 새 창") {
            startCountdown(3) { startActivity(Intent(this, BenchActivity::class.java).putExtra(EXTRA_SECURE, true)) }
        })
        r2.addView(Button(this).small("초기화") { Touches.reset(); refresh() })
        r2.addView(Button(this).small("기록 복사") { copyReport() })

        area = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(40, 255, 255, 255))
        }
        val r3 = row()
        r3.addView(CheckBox(this).apply {
            text = "가려짐 필터"
            setTextColor(Color.WHITE)
            setOnCheckedChangeListener { _, c -> area.filterTouchesWhenObscured = c; logSetting("filterTouchesWhenObscured=$c") }
        })
        r3.addView(CheckBox(this).apply {
            text = "접근성 민감"
            setTextColor(Color.WHITE)
            setOnCheckedChangeListener { _, c ->
                area.setAccessibilityDataSensitive(if (c) View.ACCESSIBILITY_DATA_SENSITIVE_YES else View.ACCESSIBILITY_DATA_SENSITIVE_NO)
                logSetting("accessibilityDataSensitive=$c")
            }
        })

        counter = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
            gravity = Gravity.CENTER
        }
        log = TextView(this).apply {
            setTextColor(Color.rgb(200, 230, 255))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.MONOSPACE
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        area.addView(counter, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(80), Gravity.TOP))
        area.addView(log, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        area.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_DOWN) onAreaDown(e)
            true
        }
        root.addView(area, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply {
            setMargins(dp(8), dp(8), dp(8), dp(8))
        })

        root.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)
        if (openedSecure) Touches.add("— 보안 새 창 열림 —")
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onDestroy() {
        cancelCountdown()
        super.onDestroy()
    }

    // 창 전체에 도착한 터치 (뷰 필터 이전)
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked != MotionEvent.ACTION_DOWN) return super.dispatchTouchEvent(ev)
        Touches.windowDowns++
        if (isInjected(ev)) Touches.injected++
        val areaBefore = Touches.areaDowns
        val handled = super.dispatchTouchEvent(ev)
        // 영역 안을 눌렀는데 영역이 못 받았다면 뷰 보안 필터가 버린 것
        val loc = IntArray(2).also { area.getLocationOnScreen(it) }
        val x = ev.rawX.toInt()
        val y = ev.rawY.toInt()
        val insideArea = x >= loc[0] && x < loc[0] + area.width && y >= loc[1] && y < loc[1] + area.height
        if (insideArea && Touches.areaDowns == areaBefore) {
            Touches.add("✗ 영역 미수신 ($x,$y) ${source(ev)}${if (secure) " 보안중" else ""} ${filterState()}${windowFlags(ev)}")
            refresh()
        }
        return handled
    }

    private fun source(ev: MotionEvent) = if (isInjected(ev)) "주입" else "손가락"

    private fun filterState() =
        "[가림필터 ${if (area.filterTouchesWhenObscured) "켬" else "끔"}, 민감 ${if (area.isAccessibilityDataSensitive) "예" else "아니오"}]"

    private fun windowFlags(ev: MotionEvent) = buildString {
        if (ev.flags and MotionEvent.FLAG_WINDOW_IS_OBSCURED != 0) append(" 가려짐")
        if (ev.flags and MotionEvent.FLAG_WINDOW_IS_PARTIALLY_OBSCURED != 0) append(" 일부가려짐")
    }

    // AOSP MotionEvent 의 비공개 플래그 FLAG_IS_ACCESSIBILITY_EVENT(0x800). 공개 API가 아니므로 참고용 표시다.
    private fun isInjected(ev: MotionEvent) = (ev.flags and FLAG_IS_ACCESSIBILITY_EVENT) != 0

    private fun onAreaDown(e: MotionEvent) {
        val t = e.eventTime // 입력 수신 시각(uptime ms)
        if (Touches.firstAt == 0L) Touches.firstAt = t
        val gap = if (Touches.lastAreaAt == 0L) "-" else "${t - Touches.lastAreaAt}"
        Touches.lastAreaAt = t
        Touches.areaDowns++
        Touches.add(
            "#${Touches.areaDowns} +${t - Touches.firstAt}ms 간격 ${gap}ms " +
                "(${e.rawX.toInt()},${e.rawY.toInt()}) ${source(e)}${if (secure) " 보안중" else ""} ${filterState()}${windowFlags(e)}"
        )
        refresh()
    }

    private fun setSecure(on: Boolean) {
        secure = on
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        Touches.add("— 보안 ${if (on) "켜짐" else "꺼짐"} (같은 창) —")
        if (::status.isInitialized) refresh()
    }

    private fun startCountdown(seconds: Int, action: () -> Unit) {
        cancelCountdown()
        var left = seconds
        val r = object : Runnable {
            override fun run() {
                if (left == 0) {
                    countdown = null
                    action()
                    refresh()
                    return
                }
                status.text = "${left}초 뒤 실행…"
                left--
                main.postDelayed(this, 1000)
            }
        }
        countdown = r
        r.run()
    }

    private fun cancelCountdown() {
        countdown?.let { main.removeCallbacks(it) }
        countdown = null
    }

    private fun logSetting(s: String) {
        Touches.add("— 설정 $s —")
        refresh()
    }

    private fun refresh() {
        if (countdown == null) {
            val kind = if (intent.getBooleanExtra(EXTRA_SECURE, false)) "보안 새 창" else "기본 창"
            status.text = "$kind · 보안 ${if (secure) "켜짐 🔒" else "꺼짐"}"
        }
        counter.text = "${Touches.areaDowns}"
        log.text = buildString {
            appendLine("창 수신 ${Touches.windowDowns} / 영역 수신 ${Touches.areaDowns} / 주입(참고) ${Touches.injected}")
            Touches.lines.toList().takeLast(14).forEach { appendLine(it) }
        }
    }

    private fun copyReport() {
        val text = buildString {
            appendLine("[트리거탭 테스트벤치 기록]")
            appendLine("기기: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("창 수신 ${Touches.windowDowns} / 영역 수신 ${Touches.areaDowns} / 주입(참고) ${Touches.injected}")
            Touches.lines.forEach { appendLine(it) }
        }
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("testbench", text))
        Toast.makeText(this, "복사됨", Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val EXTRA_SECURE = "secure"
        private const val FLAG_IS_ACCESSIBILITY_EVENT = 0x800
    }
}
