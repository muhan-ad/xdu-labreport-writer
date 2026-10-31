package com.labmaker.app;
import org.junit.Test;import org.junit.Rule;import org.junit.rules.TemporaryFolder;import static org.junit.Assert.*;import java.io.*;import java.nio.file.Files;
public class ReportFilePolicyTest {
 @Rule public TemporaryFolder temporary=new TemporaryFolder();
 final String id="abcdef123456",generation="12345678-1234-1234-1234-123456789abc";
 @Test public void resolvesOnlyFixedPrivateReport()throws Exception {File base=temporary.newFolder(),file=new File(base,"lab-maker/v1/reports/"+id+"/"+generation+"/report.docx");assertTrue(file.getParentFile().mkdirs());Files.write(file.toPath(),new byte[]{1,2});assertEquals(file.getCanonicalFile(),ReportFilePolicy.resolve(new File[]{temporary.newFolder(),base},id,generation));}
 @Test public void rejectsMissingEmptyAndTraversal()throws Exception {File base=temporary.newFolder();for(String candidate:new String[]{id,"../abcdef123456",""}){try{ReportFilePolicy.resolve(new File[]{base},candidate,generation);fail();}catch(IOException expected){}}File file=new File(base,"lab-maker/v1/reports/"+id+"/"+generation+"/report.docx");assertTrue(file.getParentFile().mkdirs());assertTrue(file.createNewFile());try{ReportFilePolicy.resolve(new File[]{base},id,generation);fail();}catch(IOException expected){}}
}
