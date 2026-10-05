import { test, expect } from '@playwright/test';
import { workspaceCases } from './helpers/workspace-redesign-cases.mjs';
for (const [name,run] of workspaceCases) {
  test(name, async ({page},info) => {
    const result=await run({page,expect,layout:info.project.name.includes('mobile')?'mobile':'desktop'});
    if(result) await info.attach('element-observations',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  });
}
