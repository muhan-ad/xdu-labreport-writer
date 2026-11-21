import { SchoolReportView } from "../../src/features/school-reports.ts";
import type { Repository } from "../../src/domain/repository.ts";
import type { SchoolReports } from "../../src/platform/school-reports.ts";
import type { SavedSchoolAccount } from "../../src/domain/school-accounts.ts";

const first: SavedSchoolAccount = {id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",system:"report",account:"2500000000",label:"",locked:false,passwordLength:8};
const second: SavedSchoolAccount = {...first,id:"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",account:"2500000001",passwordLength:12};

export function createFixture() {
  const host = document.querySelector<HTMLElement>("#host")!;
  const calls: string[][] = [];
  let rows = [first];
  let preferred: string | null = null;
  let fail = false;
  const repo = {loadSchoolPreload:async () => ({version:1,course:null,report:preferred})} as Repository;
  const service = {
    async connectSaved(id:string, account:string) {calls.push(["saved",id,account]);},
    async connect(account:string, password:string) {calls.push(["manual",account,password]);},
    async clear() {},
  } as SchoolReports;
  const accounts = {async list() {if (fail) throw Error("读取失败");return rows;}};
  const view = new SchoolReportView(() => {},repo,[],service,undefined,accounts);
  return {
    mount: () => view.mount(host),
    clearAccounts: () => {rows=[];view.mount(host);},
    preferredAccount: () => {rows=[first,second];preferred=second.id;view.mount(host);},
    failRead: (value:boolean) => {fail=value;},
    calls: () => calls,
  };
}
