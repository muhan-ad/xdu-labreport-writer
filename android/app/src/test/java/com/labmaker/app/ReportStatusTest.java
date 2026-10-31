package com.labmaker.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
public class ReportStatusTest {
 @Test public void scoresAreStrict(){assertEquals(Double.valueOf(4.5),ReportStatus.numeric("４．５ 分"));assertEquals(Double.valueOf(0),ReportStatus.numeric("0"));assertNull(ReportStatus.numeric("101"));assertNull(ReportStatus.numeric("4.5已上传"));assertNull(ReportStatus.numeric("NaN"));}
 @Test public void recognizedYiHasProductPriority(){assertEquals("已上传",ReportStatus.status(Arrays.asList("已","无法识别")));assertEquals("未上传",ReportStatus.status(Arrays.asList("未上传 未上传","未上传未上传")));assertEquals("",ReportStatus.status(Arrays.asList("未上传","未批改")));assertEquals("",ReportStatus.status(Arrays.asList("未上传")));}
 @Test public void repeatedScoresNeedAgreement(){assertEquals(Double.valueOf(4.5),ReportStatus.agreed(Arrays.asList("4.5 4.5","4.5\n4.5")));assertNull(ReportStatus.agreed(Arrays.asList("4.5 4.5","45 45")));assertNull(ReportStatus.agreed(Arrays.asList("4.5","4.5")));assertNull(ReportStatus.agreed(Arrays.asList("100.1 100.1","100.1 100.1")));}
}
