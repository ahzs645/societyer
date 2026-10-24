import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function seed(page:Page){return page.evaluate(async()=>{
  const path='/src/lib/localDataClient.ts';const {localDataClient:client}=await import(path);const societyId=(await client.query('society:list',{}))[0]._id;
  const itemId=await client.mutation('invoices:upsertCatalogItem',{societyId,name:'Volume maintenance',currency:'CAD',unitPriceCents:10000});
  const customerId=await client.mutation('accounting:upsertCounterparty',{societyId,name:'Volume pricing customer',kind:'customer',email:'volume@example.test'});
  const priceListId=await client.mutation('invoicePreferences:savePriceList',{societyId,name:'Volume contract',currency:'CAD',active:true,entries:[{catalogItemId:itemId,unitPriceCents:9000}],validFrom:'2020-01-01',validTo:'2099-12-31',tiers:[{catalogItemId:itemId,minimumQuantity:5,unitPriceCents:7500}]});
  await client.mutation('invoicePreferences:assignCustomer',{societyId,partyKey:`organization:${customerId}`,priceListId});
  const invoiceId=await client.mutation('invoices:upsert',{societyId,partyKind:'organization',counterpartyId:customerId,billToName:'Volume pricing customer',issueDate:'2026-01-02',terms:'net_30',currency:'CAD',lines:[{key:'maintenance',catalogItemId:itemId,item:'Volume maintenance',quantity:1,unitPriceCents:9000,rateOverridden:false}]});
  return {societyId,itemId,customerId,priceListId,invoiceId};
});}

test('saved invoice filters, custom columns and matching exports persist across reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/app/invoices');await expect(page.getByRole('button',{name:'Filters and columns',exact:true})).toBeVisible();await seed(page);await page.reload();
  await page.getByRole('searchbox',{name:'Search invoices',exact:true}).fill('Volume pricing customer');
  await expect(page.locator('.invoice-table--list tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Filters and columns',exact:true}).click();const drawer=page.getByRole('dialog');
  await drawer.getByLabel('View name',{exact:true}).fill('Accounts follow-up');
  await drawer.getByLabel('Issued from',{exact:true}).fill('2026-01-01');await drawer.getByLabel('Issued to',{exact:true}).fill('2026-01-31');
  await drawer.getByLabel('customer column label',{exact:true}).fill('Recipient');await drawer.getByLabel('customer column width',{exact:true}).fill('305');
  await drawer.getByText('Due',{exact:true}).click();
  await drawer.getByRole('button',{name:'Save view',exact:true}).click();await expect(drawer.getByRole('button',{name:'Update saved view',exact:true})).toBeVisible();
  await drawer.getByRole('button',{name:'Apply view',exact:true}).click();
  await expect(page.getByRole('columnheader',{name:'Recipient',exact:true})).toBeVisible();await expect(page.getByRole('columnheader',{name:'Due',exact:true})).toHaveCount(0);
  const url=page.url();expect(url).toContain('view=');await page.reload();await expect(page.getByRole('columnheader',{name:'Recipient',exact:true})).toBeVisible();await expect(page.locator('.invoice-table--list tbody tr')).toHaveCount(1);
  // This goes through the actual configured export projection, including custom labels/order.
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:"More actions",exact:true}).first().click();
  const csvOption=page.getByRole('menuitem',{name:/CSV/i});
  if(await csvOption.count()){await csvOption.first().click();}else{await page.getByRole('menuitem',{name:/Export.*view/i}).first().click();}
  const download=await downloading;const body=await readFile((await download.path())!);expect(body.toString()).toContain('Recipient');expect(body.toString()).toContain('Volume pricing customer');expect(body.toString().split('\n')[0]).not.toMatch(/(^|,)Due(,|$)/);
  // Reset and reselect the account-owned saved view.
  const select=page.getByLabel('Saved invoice view',{exact:true});await select.selectOption('');await expect(page.getByRole('columnheader',{name:'Customer',exact:true})).toBeVisible();
  const savedValue=await select.locator('option').filter({hasText:'Accounts follow-up'}).getAttribute('value');await select.selectOption(savedValue!);await expect(page.getByRole('columnheader',{name:'Recipient',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.invoice-table--custom-view thead')).toBeVisible();
  expect(await page.locator('.invoice-table--custom-view').evaluate(table=>getComputedStyle(table).display)).toBe('table');
  expect(errors).toEqual([]);
});

test('customer assignment and quantity tiers update rates while preserving manual overrides',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/app/invoices');await expect(page.getByRole('button',{name:'Filters and columns',exact:true})).toBeVisible();await seed(page);
  await page.goto('/app/invoices?builder=new');const form=page.locator('.invoice-builder__form');
  await form.getByRole('combobox',{name:'Bill to',exact:true}).fill('Volume pricing customer');await page.getByRole('option',{name:/Volume pricing customer/}).first().click();await expect(form.locator('.billto__name')).toHaveText('Volume pricing customer');
  await expect(form.getByLabel('Price list',{exact:true})).toContainText('Volume contract');
  await form.getByRole('button',{name:'From catalog',exact:true}).click();await page.getByRole('menuitem',{name:/Volume maintenance/}).click();
  const rate=form.locator('.line-editor__field--price input'),qty=form.locator('.line-editor__field--qty input');
  await expect(rate).toHaveValue('90.00');await qty.fill('5');await expect(rate).toHaveValue('75.00');
  await rate.fill('67.00');await qty.fill('10');await expect(rate).toHaveValue('67.00');
  await form.getByText('Item details and tax mode',{exact:true}).click();await form.getByRole('button',{name:'Use current price-list rate',exact:true}).click();await expect(rate).toHaveValue('75.00');
  expect(errors).toEqual([]);
});

test('new builders load defaults beyond the initial template page and keep draft edits during collection refresh',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/app/financials/reports/catalog');
  const template=await page.evaluate(async()=>{
    const clientPath='/src/lib/localDataClient.ts',templatePath='/shared/invoiceCommerce.ts';
    const {localDataClient:client}=await import(clientPath),{DEFAULT_INVOICE_TEMPLATE}=await import(templatePath);
    const societyId=(await client.query('society:list',{}))[0]._id;
    let id='';const config={...DEFAULT_INVOICE_TEMPLATE,name:'Default beyond initial page',title:'Beyond page 200 invoice'};
    for(let index=0;index<201;index++)id=await client.mutation('invoices:upsertTemplate',{societyId,config:index===200?config:{...DEFAULT_INVOICE_TEMPLATE,name:`Earlier template ${index}`},makeDefault:index===200});
    return {id,societyId,config};
  });
  await page.goto('/app/invoices?builder=new');
  const form=page.locator('.invoice-builder__form');
  await expect(form.getByLabel('Template',{exact:true})).toContainText('Default beyond initial page');
  await expect(page.locator('.document-preview').first()).toContainText('Beyond page 200 invoice');
  await form.getByLabel('PO or reference',{exact:true}).fill('Preserve unsaved reference');
  await page.evaluate(async({id,societyId,config})=>{
    const path='/src/lib/localDataClient.ts';const {localDataClient:client}=await import(path);
    await client.mutation('invoices:upsertTemplate',{societyId,id,config:{...config,footer:'Updated catalog template footer'}});
  },template);
  await expect(form.getByLabel('Template',{exact:true})).toContainText('Default beyond initial page (current design)');
  await expect(form.getByLabel('PO or reference',{exact:true})).toHaveValue('Preserve unsaved reference');
  await expect(form.getByLabel('Template',{exact:true})).toContainText('Default beyond initial page');
  expect(errors).toEqual([]);
});
