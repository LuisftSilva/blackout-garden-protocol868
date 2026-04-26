package com.savvygenius.blackoutgarden;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String TAG = "BlackoutGarden";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            requestWindowFeature(Window.FEATURE_NO_TITLE);

            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            );

            WebView.setWebContentsDebuggingEnabled(true);

            webView = new WebView(this);
            webView.setBackgroundColor(Color.rgb(5, 9, 6));
            setContentView(webView);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

            webView.setWebViewClient(new WebViewClient());

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                    Log.d(
                        TAG,
                        consoleMessage.message()
                            + " -- line "
                            + consoleMessage.lineNumber()
                            + " of "
                            + consoleMessage.sourceId()
                    );
                    return true;
                }
            });

            webView.loadUrl("file:///android_asset/game/index.html");

        } catch (Throwable e) {
            Log.e(TAG, "Fatal startup error", e);
            showFallbackError(e);
        }
    }

    private void showFallbackError(Throwable e) {
        TextView errorView = new TextView(this);
        errorView.setTextColor(Color.rgb(215, 255, 233));
        errorView.setBackgroundColor(Color.rgb(5, 9, 6));
        errorView.setTextSize(14);
        errorView.setPadding(32, 32, 32, 32);
        errorView.setText(
            "Blackout Garden failed to start.\n\n"
            + e.getClass().getName()
            + "\n\n"
            + e.getMessage()
            + "\n\nSend this screen/log to debug."
        );
        setContentView(errorView);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
