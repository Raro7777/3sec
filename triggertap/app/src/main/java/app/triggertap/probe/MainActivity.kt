package app.triggertap.probe

import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** 설정·진단 기록 화면. 실제 감시·탭 조작은 대상 앱 위에 뜨는 플로팅 패널에서 한다. */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var serviceState: TextView
    private lateinit var targetView: TextView
    private lateinit var pointView: TextView
    private lateinit var summaryView: TextView
    private lateinit var logView: TextView
    private val onLog: () -> Unit = { refreshLog() }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        fun text(s: String, sizeSp: Float = 14f, bold: Boolean = false) = TextView(this).apply {
            text = s
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            if (bold) setTypeface(typeface, Typeface.BOLD)
            setPadding(0, dp(6), 0, dp(2))
            col.addView(this)
        }
        fun button(s: String, onClick: () -> Unit) = Button(this).apply {
            text = s
            isAllCaps = false
            setOnClickListener { onClick() }
            col.addView(this)
        }

        text("트리거탭 진단 (0단계)", 20f, bold = true)
        text("선택한 앱 창의 캡처 결과 코드만 기록합니다. 이미지는 즉시 해제하며 저장·분석·전송하지 않습니다. 탭은 패널 버튼을 누를 때만 보냅니다.", 13f)

        serviceState = text("", 14f, bold = true)
        button("접근성 설정 열기") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }

        text("1. 대상 앱", 16f, bold = true)
        targetView = text("")
        button("대상 앱 선택") { pickTarget() }

        text("2. 값", 16f, bold = true)
        numberField(col, "감시 간격(ms, ${Prefs.POLL_RANGE.first}~${Prefs.POLL_RANGE.last})", prefs.pollIntervalMs) { prefs.pollIntervalMs = it }
        numberField(col, "탭 횟수(${Prefs.TAP_COUNT_RANGE.first}~${Prefs.TAP_COUNT_RANGE.last})", prefs.tapCount) { prefs.tapCount = it }
        numberField(col, "탭 시작 간격(ms, ${Prefs.TAP_INTERVAL_RANGE.first}~${Prefs.TAP_INTERVAL_RANGE.last})", prefs.tapIntervalMs) { prefs.tapIntervalMs = it }
        numberField(col, "누름 시간(ms, ${Prefs.TAP_HOLD_RANGE.first}~${Prefs.TAP_HOLD_RANGE.last})", prefs.tapHoldMs) { prefs.tapHoldMs = it }
        pointView = text("")

        text("3. 플로팅 패널", 16f, bold = true)
        text("패널을 연 뒤 대상 앱으로 가서: [표식]으로 위치 지정 → [감시 ▶]로 캡처 결과 확인 → [탭1]/[탭×N]으로 탭 전달 확인.", 13f)
        button("패널 열기") {
            val s = ProbeService.instance
            if (s == null) toast("먼저 접근성 설정에서 '트리거탭 진단'을 켜세요") else s.overlay.showPanel()
        }

        text("4. 진단 기록", 16f, bold = true)
        summaryView = text("", 13f)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(Button(this).apply {
            text = "보고서 복사"
            isAllCaps = false
            setOnClickListener {
                getSystemService(ClipboardManager::class.java)
                    .setPrimaryClip(ClipData.newPlainText("triggertap-report", ProbeLog.report(prefs)))
                toast("복사됨")
            }
        })
        row.addView(Button(this).apply {
            text = "기록 지우기"
            isAllCaps = false
            setOnClickListener { ProbeLog.clear() }
        })
        col.addView(row)
        logView = text("", 11f).apply { typeface = Typeface.MONOSPACE }

        val scroll = ScrollView(this).apply { addView(col) }
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(scroll)
    }

    private fun numberField(parent: LinearLayout, label: String, initial: Int, save: (Int) -> Unit) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        row.addView(TextView(this).apply { text = label }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val edit = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            setText(initial.toString())
            minEms = 4
            setOnFocusChangeListener { v, hasFocus ->
                if (!hasFocus) {
                    val et = v as EditText
                    et.text.toString().toIntOrNull()?.let(save)
                    refresh()
                }
            }
        }
        row.addView(edit)
        parent.addView(row)
        fields += edit to save
    }

    private val fields = mutableListOf<Pair<EditText, (Int) -> Unit>>()

    override fun onResume() {
        super.onResume()
        ProbeLog.addListener(onLog)
        refresh()
    }

    override fun onPause() {
        // 포커스를 잃지 않고 나가도 입력값을 저장
        fields.forEach { (et, save) -> et.text.toString().toIntOrNull()?.let(save) }
        ProbeLog.removeListener(onLog)
        super.onPause()
    }

    private fun refresh() {
        serviceState.text = if (ProbeService.instance != null) "접근성 서비스: 켜짐" else "접근성 서비스: 꺼짐 — 아래 버튼으로 켜세요"
        targetView.text = prefs.targetPackage?.let { "${prefs.targetLabel ?: ""}\n$it" } ?: "미지정"
        pointView.text = "탭 좌표: ${prefs.point?.let { "(${it.first}, ${it.second})" } ?: "미지정 (패널의 [표식]으로 지정)"}"
        refreshLog()
    }

    private fun refreshLog() {
        summaryView.text = ProbeLog.summary()
        logView.text = ProbeLog.recentLines(80).reversed().joinToString("\n")
        pointView.text = "탭 좌표: ${prefs.point?.let { "(${it.first}, ${it.second})" } ?: "미지정 (패널의 [표식]으로 지정)"}"
    }

    private fun pickTarget() {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = packageManager.queryIntentActivities(intent, 0)
            .map { it.loadLabel(packageManager).toString() to it.activityInfo.packageName }
            .filter { it.second != packageName }
            .distinctBy { it.second }
            .sortedWith(compareBy({ !it.second.startsWith("app.triggertap") }, { it.first.lowercase() }))
        AlertDialog.Builder(this)
            .setTitle("대상 앱")
            .setItems(apps.map { "${it.first}\n${it.second}" }.toTypedArray()) { _, i ->
                val (label, pkg) = apps[i]
                if (pkg != prefs.targetPackage) {
                    ProbeService.instance?.stopPolling("대상 변경")
                    // 앱이 바뀌면 이전 좌표는 의미가 없다.
                    prefs.point = null
                }
                prefs.targetPackage = pkg
                prefs.targetLabel = label
                ProbeLog.add("대상 지정: $label ($pkg)")
                refresh()
            }
            .show()
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
