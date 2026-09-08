package app.bloomleague.manager;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

/**
 * 블룸 리그 매니저 — web/dist/bloom.html(단일 HTML) 을 WebView 로 감싼 셸.
 * 게임 코드는 그대로이고, 이 파일은 화면 한 장·뒤로가기·외부 링크만 다룬다.
 *
 *  - 자산은 https://appassets.androidplatform.net/assets/bloom.html 로 서빙한다(WebViewAssetLoader).
 *    file:// 가 아니라 https 오리진이라 localStorage 저장이 안정적이다.
 *  - 뒤로가기: 페이지의 window.bloomBack() 이 처리했으면(true) 끝, 아니면 두 번 눌러 종료.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String URL = "https://" + HOST + "/assets/bloom.html";
    private static final long EXIT_WINDOW_MS = 2000;

    private WebView web;
    private long lastBack = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A1017"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage(세이브)
        s.setMediaPlaybackRequiresUserGesture(false); // WebAudio 효과음
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);                           // 시스템 글자 크기와 무관하게 앱 레이아웃 유지(본문 16px+)
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;   // 외부 링크는 브라우저로
            }
        });
        web.setWebChromeClient(new WebChromeClient());   // confirm() 대화상자
        setContentView(web);

        if (saved != null) web.restoreState(saved);
        if (web.getUrl() == null) web.loadUrl(URL);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.bloomBack && window.bloomBack()) ? 1 : 0", result -> {
            if ("1".equals(result)) return;
            long now = System.currentTimeMillis();
            if (now - lastBack < EXIT_WINDOW_MS) { finish(); return; }
            lastBack = now;
            Toast.makeText(MainActivity.this, R.string.back_again, Toast.LENGTH_SHORT).show();
        });
    }

    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
