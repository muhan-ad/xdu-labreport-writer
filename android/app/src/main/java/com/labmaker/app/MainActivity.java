package com.labmaker.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LabAIPlugin.class);
        registerPlugin(LabResourcesPlugin.class);
        registerPlugin(LabDataUpdatesPlugin.class);
        registerPlugin(LabAppUpdatesPlugin.class);
        registerPlugin(LabFeedbackPlugin.class);
        registerPlugin(LabContributionsPlugin.class);
        registerPlugin(LabReportFilesPlugin.class);
        registerPlugin(LabPortalPlugin.class);
        registerPlugin(LabReportPortalPlugin.class);
        registerPlugin(LabSchoolAccountsPlugin.class);
        registerPlugin(LabAcademicPlugin.class);
        super.onCreate(state);
    }
}
