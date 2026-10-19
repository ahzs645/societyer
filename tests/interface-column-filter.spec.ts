import {expect, test} from "@playwright/test";
test("numeric comparison picker paints above its column menu and commits a pointer selection", async ({page}, info) => {
 test.skip(!["desktop","phone"].includes(info.project.name));
 await page.goto("/tests/fixtures/column-filter.html");
 await page.getByRole("button",{name:"Documents column",exact:true}).click();
 const menu=page.getByRole("dialog",{name:"Documents column",exact:true});
 await menu.getByRole("button",{name:"Documents filter condition",exact:true}).click();
 await page.getByRole("option",{name:"At least",exact:true}).click();
 await expect(menu.getByRole("button",{name:"Documents filter condition",exact:true})).toHaveText("At least");
 await expect(page.getByRole("listbox")).toHaveCount(0);
 await menu.getByRole("button",{name:"Documents filter condition",exact:true}).click();
 await page.getByRole("option",{name:"Has no value",exact:true}).click();
 await expect(menu.getByRole("textbox",{name:"Documents filter value"})).toHaveCount(0);
 await expect(menu).toBeVisible();
});
