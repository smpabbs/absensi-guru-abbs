package id.sch.alabidin.absensiguru;

import android.Manifest;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Minta izin kamera & lokasi saat aplikasi dibuka (dipakai webview absensi).
        if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(
                new String[]{
                    Manifest.permission.CAMERA,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                },
                100
            );
        }
    }
}
