package app.triggertap.probe

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import java.util.concurrent.Executor

/**
 * 0단계 타당성 확인용 서비스.
 *
 * - 감시: 대상 패키지의 애플리케이션 창에 takeScreenshotOfWindow 를 주기적으로 요청하고 결과 코드만 기록한다.
 *   창 ID는 고정하지 않고 매번 다시 찾는다(보안 화면이 새 창으로 뜨는지 확인하기 위함).
 * - 시험 탭: 사용자가 패널에서 누를 때만 실행한다. 캡처 결과로 자동 탭을 보내지 않는다.
 *
 * 감시·탭 상태는 모두 [worker] 스레드 하나에서 바뀐다. 오버레이만 메인 스레드.
 */
class ProbeService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: ProbeService? = null
            private set

        private const val CAPTURE_TIMEOUT_MS = 2_000L
        private const val MARKER_HIDE_SETTLE_MS = 150L

        fun resultName(code: Int): String = when (code) {
            ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> "SECURE_WINDOW"
            ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> "INTERVAL_TIME_SHORT"
            ERROR_TAKE_SCREENSHOT_INVALID_WINDOW -> "INVALID_WINDOW"
            ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> "INVALID_DISPLAY"
            ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> "NO_ACCESSIBILITY_ACCESS"
            ERROR_TAKE_SCREENSHOT_INTERNAL_ERROR -> "INTERNAL_ERROR"
            else -> "ERROR_$code"
        }
    }

    private lateinit var workerThread: HandlerThread
    private lateinit var worker: Handler
    private val workerExecutor = Executor { worker.post(it) }
    private val main = Handler(Looper.getMainLooper())

    lateinit var prefs: Prefs
        private set
    lateinit var overlay: OverlayController
        private set

    // ---- 감시 상태 (worker 에서만 바꾼다) ----
    @Volatile
    private var polling = false
    private var pollSession = 0
    private var requestSeq = 0
    private var inFlightRequest = 0
    private var pendingPoll: Runnable? = null
    private var lastResult: String? = null
    private var lastWindowId: Int? = null
    private var lastSuccessAt = 0L

    // 창 상태 변경 이벤트로 본 마지막 전면 패키지 (root 를 못 읽는 창의 보조 식별용)
    @Volatile
    private var lastEventPackage: String? = null
    @Volatile
    private var lastEventWindowId: Int = -1

    // ---- 탭 상태 (worker 전용) ----
    private var tapRun = 0
    private var tapping = false
    private var tapsCompleted = 0
    private val sentTimes = mutableListOf<Long>()
    private var resumePollingAfterTaps = false

    @Volatile
    var statusLine: String = "대기"
        private set

    override fun onServiceConnected() {
        prefs = Prefs(this)
        workerThread = HandlerThread("triggertap-probe").also { it.start() }
        worker = Handler(workerThread.looper)
        overlay = OverlayController(this)
        instance = this
        ProbeLog.add("서비스 연결됨. 자동 감시·탭은 재개하지 않음")
        setStatus("대기")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            lastEventPackage = event.packageName?.toString()
            lastEventWindowId = event.windowId
        }
    }

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        shutdown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    private fun shutdown() {
        if (instance !== this) return
        instance = null
        main.post { overlay.removeAll() }
        worker.post {
            polling = false
            pollSession++
            tapRun++
            tapping = false
        }
        workerThread.quitSafely()
        ProbeLog.add("서비스 종료")
    }

    // ------------------------------------------------------------------ 감시

    val isPolling: Boolean get() = polling

    fun startPolling() = worker.post { startPollingOnWorker() }

    private fun startPollingOnWorker() {
        if (polling) return
        val target = prefs.targetPackage
        if (target == null) {
            ProbeLog.add("감시 불가: 대상 앱 미지정")
            return
        }
        polling = true
        pollSession++
        lastResult = null
        lastWindowId = null
        ProbeLog.add("감시 시작: $target, 간격 ${prefs.pollIntervalMs}ms (세션 $pollSession)")
        schedulePoll(0)
    }

    fun stopPolling(reason: String = "사용자 중지") = worker.post {
        // 탭 회차 중이면 감시는 이미 쉬고 있다. 회차가 끝나도 다시 켜지지 않게 한다.
        resumePollingAfterTaps = false
        if (!polling) return@post
        polling = false
        pollSession++
        pendingPoll?.let { worker.removeCallbacks(it) }
        pendingPoll = null
        ProbeLog.add("감시 정지: $reason")
        setStatus("감시 정지")
    }

    private fun schedulePoll(delayMs: Long) {
        val session = pollSession
        pendingPoll?.let { worker.removeCallbacks(it) }
        val r = Runnable { pollOnce(session) }
        pendingPoll = r
        worker.postDelayed(r, delayMs.coerceAtLeast(0))
    }

    private data class TargetWindow(
        val id: Int,
        val active: Boolean,
        val focused: Boolean,
        val via: String,
        val bounds: Rect,
    )

    private fun findTargetWindow(target: String): TargetWindow? {
        val candidates = mutableListOf<TargetWindow>()
        for (w in windows) {
            if (w.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
            val rootPackage = try {
                w.root?.packageName?.toString()
            } catch (_: RuntimeException) {
                null
            }
            val via = when {
                rootPackage == target -> "root"
                rootPackage == null && w.id == lastEventWindowId && lastEventPackage == target -> "event"
                else -> continue
            }
            val r = Rect().also { w.getBoundsInScreen(it) }
            candidates += TargetWindow(w.id, w.isActive, w.isFocused, via, r)
        }
        return candidates.firstOrNull { it.active } ?: candidates.firstOrNull { it.focused } ?: candidates.firstOrNull()
    }

    private fun pollOnce(session: Int) {
        if (!polling || session != pollSession || tapping) return
        val target = prefs.targetPackage ?: return
        val start = SystemClock.uptimeMillis()
        val win = findTargetWindow(target)
        if (win == null) {
            record("NO_TARGET_WINDOW", null, null, "")
            schedulePoll(prefs.pollIntervalMs - (SystemClock.uptimeMillis() - start))
            return
        }

        val request = ++requestSeq
        inFlightRequest = request
        val timeout = Runnable {
            if (inFlightRequest == request) {
                inFlightRequest = 0
                finishCapture(session, request, win, start, "TIMEOUT")
            }
        }
        worker.postDelayed(timeout, CAPTURE_TIMEOUT_MS)

        takeScreenshotOfWindow(win.id, workerExecutor, object : TakeScreenshotCallback {
            override fun onSuccess(result: ScreenshotResult) {
                // 이미지는 보지 않는다. 늦게 온 결과도 즉시 해제.
                result.hardwareBuffer.close()
                onCaptureResult(session, request, win, start, "SUCCESS", timeout)
            }

            override fun onFailure(errorCode: Int) {
                onCaptureResult(session, request, win, start, resultName(errorCode), timeout)
            }
        })
    }

    private fun onCaptureResult(session: Int, request: Int, win: TargetWindow, start: Long, result: String, timeout: Runnable) {
        if (request != inFlightRequest) {
            ProbeLog.add("늦은 캡처 콜백 무시: 요청 $request, $result")
            return
        }
        worker.removeCallbacks(timeout)
        inFlightRequest = 0
        finishCapture(session, request, win, start, result)
    }

    private fun finishCapture(session: Int, request: Int, win: TargetWindow, start: Long, result: String) {
        val latency = SystemClock.uptimeMillis() - start
        val flags = buildString {
            append(if (win.active) "A" else "-")
            append(if (win.focused) "F" else "-")
            append(" via ${win.via}")
        }
        record(result, win.id, latency, flags)
        if (!polling || session != pollSession) return
        // 시작 시각 기준 간격 유지(시작→시작). 응답이 늦었으면 바로 다음 요청.
        schedulePoll(prefs.pollIntervalMs - (SystemClock.uptimeMillis() - start))
    }

    private fun record(result: String, windowId: Int?, latency: Long?, flags: String) {
        ProbeLog.countCapture(result, latency)
        val now = SystemClock.uptimeMillis()
        if (result != lastResult || windowId != lastWindowId) {
            val sinceSuccess =
                if (result == "SECURE_WINDOW" && lastResult == "SUCCESS") " (직전 성공 후 +${now - lastSuccessAt}ms)" else ""
            val from = lastResult?.let { "$it(#${lastWindowId ?: "-"}) → " } ?: ""
            ProbeLog.add("변화: $from$result(#${windowId ?: "-"}) $flags${latency?.let { " ${it}ms" } ?: ""}$sinceSuccess")
            if (lastResult == "SUCCESS" && result == "SECURE_WINDOW") {
                ProbeLog.add("★ 정상→보안 전환 감지 (창 ID ${if (windowId == lastWindowId) "같음" else "바뀜"})")
            }
        }
        if (result == "SUCCESS") lastSuccessAt = now
        lastResult = result
        lastWindowId = windowId
        setStatus("#${windowId ?: "-"} $result${latency?.let { " ${it}ms" } ?: ""}")
    }

    // ------------------------------------------------------------------ 시험 탭

    /** 표식 위치에 [count]번 탭. 1회 시험이면 count = 1. */
    fun runTaps(count: Int) = worker.post {
        if (tapping) {
            ProbeLog.add("탭 거부: 이미 실행 중")
            return@post
        }
        val point = prefs.point
        if (point == null) {
            ProbeLog.add("탭 거부: 좌표 미지정 (표식을 먼저 놓으세요)")
            return@post
        }
        val (x, y) = point
        val screen = getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
        if (!screen.contains(x, y)) {
            ProbeLog.add("탭 거부: 좌표 ($x,$y)가 화면 $screen 밖")
            return@post
        }
        if (overlay.panelContains(x, y)) {
            ProbeLog.add("탭 거부: 좌표가 패널과 겹침. 패널을 옮기세요")
            return@post
        }
        val interval = prefs.tapIntervalMs.toLong()
        val hold = prefs.tapHoldMs.toLong()
        if (hold >= interval) {
            ProbeLog.add("탭 거부: 누름 ${hold}ms ≥ 간격 ${interval}ms")
            return@post
        }

        tapping = true
        tapsCompleted = 0
        sentTimes.clear()
        val run = ++tapRun
        resumePollingAfterTaps = polling
        if (polling) {
            // 명세 7장: 회차 중에는 캡처 요청을 멈춘다.
            pendingPoll?.let { worker.removeCallbacks(it) }
            pollSession++
            inFlightRequest = 0
        }
        ProbeLog.add("탭 회차 $run 시작: ($x,$y) ${count}회, 간격 ${interval}ms, 누름 ${hold}ms")
        setStatus("탭 0/$count")
        main.post {
            overlay.hideMarker()
            worker.postDelayed({ sendTap(run, 0, count, x, y, interval, hold, SystemClock.uptimeMillis()) }, MARKER_HIDE_SETTLE_MS)
        }
    }

    fun cancelTaps() = worker.post {
        if (!tapping) return@post
        finishTaps(tapRun, "사용자 중지")
    }

    private fun sendTap(
        run: Int, index: Int, count: Int, x: Int, y: Int,
        interval: Long, hold: Long, runStart: Long,
    ) {
        val sent = sentTimes
        if (run != tapRun || !tapping) return
        val now = SystemClock.uptimeMillis()
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, hold))
            .setDisplayId(Display.DEFAULT_DISPLAY)
            .build()
        val timeout = Runnable { finishTaps(run, "탭 ${index + 1} 완료 콜백 시간 초과") }

        val accepted = dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                if (run != tapRun || !tapping) return
                worker.removeCallbacks(timeout)
                val done = SystemClock.uptimeMillis()
                tapsCompleted = index + 1
                val planned = if (index == 0) 0 else (sent[index - 1] - runStart) + interval
                ProbeLog.add("  탭 ${index + 1}: 목표 +${planned}ms, 전송 +${now - runStart}ms, 완료 +${done - runStart}ms")
                setStatus("탭 ${index + 1}/$count")
                if (index + 1 >= count) {
                    finishTaps(run, null)
                } else {
                    // 다음 탭 = 직전 실제 전송 + 간격. 늦었으면 바로 보내되 몰아서 보충하지 않는다.
                    val nextAt = now + interval
                    worker.postAtTime(
                        { sendTap(run, index + 1, count, x, y, interval, hold, runStart) },
                        maxOf(nextAt, SystemClock.uptimeMillis()),
                    )
                }
            }

            override fun onCancelled(gestureDescription: GestureDescription) {
                if (run != tapRun || !tapping) return
                worker.removeCallbacks(timeout)
                finishTaps(run, "탭 ${index + 1} 취소됨(onCancelled)")
            }
        }, worker)

        if (!accepted) {
            finishTaps(run, "탭 ${index + 1} 전송 거부(dispatchGesture=false)")
            return
        }
        sent.add(now)
        worker.postDelayed(timeout, hold + 1_000)
    }

    private fun finishTaps(run: Int, abortReason: String?) {
        if (run != tapRun || !tapping) return
        tapping = false
        tapRun++ // 남은 콜백·예약 무효화
        val delivered = tapsCompleted
        if (sentTimes.size >= 2) {
            val gaps = sentTimes.zipWithNext { a, b -> b - a }
            ProbeLog.add("  전송 간격(ms): ${gaps.joinToString(", ")} / 평균 ${"%.1f".format(gaps.average())}")
        }
        ProbeLog.add(
            if (abortReason == null) "탭 회차 $run 완료: 전송 $delivered 회 (대상 앱이 처리했는지는 별개)"
            else "탭 회차 $run 중단: $abortReason, 전송 완료 ${delivered}회"
        )
        setStatus(if (abortReason == null) "탭 완료 $delivered" else "탭 중단")
        main.post { overlay.showMarkerIfEditing() }
        if (resumePollingAfterTaps) {
            resumePollingAfterTaps = false
            polling = false
            startPollingOnWorker()
        }
    }

    private fun setStatus(s: String) {
        statusLine = s
        main.post { if (instance === this) overlay.updateStatus(s, polling) }
    }
}
