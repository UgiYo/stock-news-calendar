package com.ugiyo.newscalendar;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.graphics.Color;
import android.net.Uri;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabColorSchemeParams;

public class MainActivity extends Activity {
    private static final String WEBSITE = "https://ugiyo.github.io/stock-news-calendar/";
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(28), dp(48), dp(28), dp(28));
        layout.setBackgroundColor(Color.rgb(244, 248, 250));
        TextView title = new TextView(this);
        title.setText("股聞日曆"); title.setTextSize(30); title.setTextColor(Color.rgb(21,48,68));
        title.setGravity(Gravity.CENTER); layout.addView(title);
        TextView text = new TextView(this);
        text.setText("台股新聞追蹤\n\n搜尋近期新聞、追蹤公司，依日期閱讀新聞與全文摘要。\n\n需要網路與支援的瀏覽器；Google 登入使用瀏覽器的安全分頁。\n\nAndroid 測試版 0.1.0");
        text.setTextSize(16); text.setGravity(Gravity.CENTER); text.setPadding(0,dp(24),0,dp(24)); layout.addView(text);
        Button open = new Button(this); open.setText("開啟新聞日曆"); open.setOnClickListener(v -> openCalendar()); layout.addView(open);
        Button share = new Button(this); share.setText("分享網站"); share.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_SEND); intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, "股聞日曆\n" + WEBSITE);
            startActivity(Intent.createChooser(intent, "分享股聞日曆"));
        }); layout.addView(share);
        setContentView(layout);
        if (saved == null) openCalendar();
    }
    private void openCalendar() {
        try {
            CustomTabsIntent tabs = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder().setToolbarColor(Color.rgb(21,48,68)).build())
                .setShowTitle(true).setUrlBarHidingEnabled(true).build();
            tabs.launchUrl(this, Uri.parse(WEBSITE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "請先安裝或啟用 Chrome 等支援 HTTPS 的瀏覽器。", Toast.LENGTH_LONG).show();
        }
    }
}
