package app.cadence.player;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CadencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
