package app.triggertap.probe

import android.content.Context
import android.content.SharedPreferences

/** 0단계 진단 설정. 값 범위는 명세 1장을 따른다. */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("probe", Context.MODE_PRIVATE)

    var targetPackage: String?
        get() = sp.getString("targetPackage", null)
        set(v) = sp.edit().putString("targetPackage", v).apply()

    var targetLabel: String?
        get() = sp.getString("targetLabel", null)
        set(v) = sp.edit().putString("targetLabel", v).apply()

    /** 화면 좌표(px). 표식을 한 번도 놓지 않았으면 null. */
    var point: Pair<Int, Int>?
        get() = if (sp.contains("pointX")) sp.getInt("pointX", 0) to sp.getInt("pointY", 0) else null
        set(v) {
            val e = sp.edit()
            if (v == null) e.remove("pointX").remove("pointY") else e.putInt("pointX", v.first).putInt("pointY", v.second)
            e.apply()
        }

    var pollIntervalMs: Int
        get() = sp.getInt("pollIntervalMs", 400)
        set(v) = sp.edit().putInt("pollIntervalMs", v.coerceIn(POLL_RANGE)).apply()

    var tapCount: Int
        get() = sp.getInt("tapCount", 5)
        set(v) = sp.edit().putInt("tapCount", v.coerceIn(TAP_COUNT_RANGE)).apply()

    var tapIntervalMs: Int
        get() = sp.getInt("tapIntervalMs", 100)
        set(v) = sp.edit().putInt("tapIntervalMs", v.coerceIn(TAP_INTERVAL_RANGE)).apply()

    var tapHoldMs: Int
        get() = sp.getInt("tapHoldMs", 30)
        set(v) = sp.edit().putInt("tapHoldMs", v.coerceIn(TAP_HOLD_RANGE)).apply()

    /** 탭마다 시작 간격을 ±이 값 안에서 무작위로 흔든다. 0이면 끔. */
    var jitterIntervalMs: Int
        get() = sp.getInt("jitterIntervalMs", 15)
        set(v) = sp.edit().putInt("jitterIntervalMs", v.coerceIn(JITTER_INTERVAL_RANGE)).apply()

    /** 탭마다 좌표를 이 반경(px)의 원 안에서 무작위로 옮긴다. 0이면 끔. */
    var jitterRadiusPx: Int
        get() = sp.getInt("jitterRadiusPx", 10)
        set(v) = sp.edit().putInt("jitterRadiusPx", v.coerceIn(JITTER_RADIUS_RANGE)).apply()

    companion object {
        val JITTER_INTERVAL_RANGE = 0..30
        val JITTER_RADIUS_RANGE = 0..40
        val POLL_RANGE = 200..2000
        val TAP_COUNT_RANGE = 1..10
        val TAP_INTERVAL_RANGE = 80..200
        val TAP_HOLD_RANGE = 10..60
    }
}
