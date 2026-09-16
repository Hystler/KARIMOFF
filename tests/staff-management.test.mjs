import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync("src/app/admin/staff/actions.ts", "utf8");
const page = readFileSync("src/app/admin/staff/page.tsx", "utf8");

test("staff accounts can be deleted without allowing self-deletion", () => {
  assert.match(actions, /export async function deleteStaffAction/);
  assert.match(actions, /await assertTrustedRequestOrigin\(\)/);
  assert.match(actions, /id === actor\.id/);
  assert.match(actions, /from\("staff_users"\)[\s\S]+\.delete\(\)[\s\S]+\.eq\("id", id\)/);
  assert.match(actions, /from\("app_sessions"\)[\s\S]+subject_type[\s\S]+subject_id/);
  assert.match(actions, /action: "staff\.delete"/);
  assert.match(actions, /redirect\("\/admin\/staff\?deleted=1"\)/);
});

test("staff page confirms deletion and explains that the phone is reusable", () => {
  assert.match(page, /ConfirmSubmitButton/);
  assert.match(page, /Удалить сотрудника/);
  assert.match(page, /Номер телефона можно использовать повторно/);
  assert.match(actions, /error\?\.code === "23505"/);
  assert.match(actions, /Сотрудник с таким номером телефона уже существует/);
});
