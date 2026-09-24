package app.triggertap.probe

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 메모리에만 있는 진단 기록. 화면 내용은 담지 않고 결과 코드·창 ID·타이밍만 남긴다.
 * 여러 스레드에서 쓰고, 화면 갱신은 메인 스레드로 알린다.
 */
object ProbeLog {
    private const val MAX_LINES = 300
    private val lines = ArrayDeque<String>()
    private val counts = linkedMapOf<String, Int>()
    private val latencies = mutableListOf<Long>()
    private val listeners = mutableSetOf<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    @Synchronized
    fun add(message: String) {
        lines.addLast("${clock.format(Date())}  $message")
        while (lines.size > MAX_LINES) lines.removeFirst()
        notifyChanged()
    }

    /** 캡처 결과 1건. 매 결과를 줄로 남기면 너무 많으므로 개수와 지연만 모은다. */
    @Synchronized
    fun countCapture(result: String, latencyMs: Long?) {
        counts[result] = (counts[result] ?: 0) + 1
        if (latencyMs != null) {
            latencies.add(latencyMs)
            if (latencies.size > 1000) latencies.removeAt(0)
        }
        notifyChanged()
    }

    @Synchronized
    fun clear() {
        lines.clear()
        counts.clear()
        latencies.clear()
        notifyChanged()
    }

    @Synchronized
    fun summary(): String = buildString {
        if (counts.isEmpty()) {
            append("캡처 결과 없음")
            return@buildString
        }
        append("캡처 결과: ")
        append(counts.entries.joinToString(", ") { "${it.key} ${it.value}" })
        if (latencies.isNotEmpty()) {
            val sorted = latencies.sorted()
            append("\n응답 시간(ms): 중앙 ${sorted[sorted.size / 2]}, 최소 ${sorted.first()}, 최대 ${sorted.last()} (n=${sorted.size})")
        }
    }

    @Synchronized
    fun report(prefs: Prefs): String = buildString {
        appendLine("[트리거탭 0단계 진단 보고서]")
        appendLine("기기: ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("빌드: ${Build.DISPLAY}")
        appendLine("대상: ${prefs.targetLabel ?: "-"} (${prefs.targetPackage ?: "미지정"})")
        appendLine("감시 간격 ${prefs.pollIntervalMs}ms, 탭 ${prefs.tapCount}회 / 간격 ${prefs.tapIntervalMs}ms / 누름 ${prefs.tapHoldMs}ms, 좌표 ${prefs.point ?: "-"}, 흔들림 ±${prefs.jitterIntervalMs}ms / 반경 ${prefs.jitterRadiusPx}px")
        appendLine("기기 가동 ${SystemClock.uptimeMillis() / 1000}s")
        appendLine(summary())
        appendLine("--- 기록 (최근 ${lines.size}줄) ---")
        lines.forEach { appendLine(it) }
    }

    @Synchronized
    fun recentLines(n: Int): List<String> = lines.toList().takeLast(n)

    fun addListener(l: () -> Unit) = synchronized(this) { listeners.add(l) }
    fun removeListener(l: () -> Unit) = synchronized(this) { listeners.remove(l) }

    private fun notifyChanged() {
        val snapshot = listeners.toList()
        main.post { snapshot.forEach { it() } }
    }
}
