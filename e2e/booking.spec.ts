import {test,expect} from '@playwright/test';
test('Book, confirm, reload, look up and cancel through the production proxy',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Make room for your health.'})).toBeVisible();
 const keyLeak=await page.request.get('/api/slots');expect(keyLeak.ok()).toBeTruthy();expect(keyLeak.headers()['x-api-key']).toBeUndefined();
 await page.locator('button.slot').first().click();
 await page.getByLabel('Full name').fill('Browser Test Patient');await page.getByLabel('Email address').fill('browser@example.com');
 await page.getByRole('button',{name:'Confirm appointment'}).click();await expect(page.getByRole('heading',{name:'Your visit is booked.'})).toBeVisible();
 const reference=await page.locator('.ticket code').innerText();
 await page.reload();await page.getByRole('button',{name:'My appointments',exact:true}).click();
 await expect(page.locator('.booking').filter({hasText:reference})).toBeVisible();
 await page.getByLabel('Look up a booking').fill(reference);await page.getByRole('button',{name:'Find booking'}).click();
 await expect(page.locator('.ticket code')).toHaveText(reference);
 await page.getByRole('button',{name:'View my appointments'}).click();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.booking').filter({hasText:reference}).getByRole('button',{name:'Cancel visit'}).click();
 await expect(page.locator('.booking').filter({hasText:reference}).locator('.badge')).toHaveText('cancelled');
 expect(errors).toEqual([]);
});
test('Mobile layout and empty-state date filter',async({page})=>{
 await page.setViewportSize({width:375,height:812});await page.goto('/');
 await expect(page.locator('button.slot').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/mobile-availability.png',fullPage:true});
 await page.getByLabel('Filter by date').fill('2099-01-01');
 await expect(page.getByText('No available appointments for this selection. Try another date.')).toBeVisible();
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});
