import {test,expect} from '@playwright/test';
test('Vercel routing metadata is removed while API query validation remains strict',async({request})=>{
 const slots=await request.get('/api/slots?page=1&limit=12&...path=slots');
 expect(slots.status()).toBe(200);
 expect(await slots.json()).toMatchObject({page:1,limit:12});
 const bookings=await request.get('/api/bookings?page=1&limit=5&...path=bookings',{
  headers:{'X-Patient-Token':'a'.repeat(64)}
 });
 expect(bookings.status()).toBe(200);
 expect(await bookings.json()).toMatchObject({page:1,limit:5});
 const invalid=await request.get('/api/slots?page=1&limit=12&...path=slots&unexpected=value');
 expect(invalid.status()).toBe(400);
 expect((await invalid.json()).error.code).toBe('validation_error');
});
test('Book, confirm, reload, look up and cancel through the production proxy',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'Make room for your health.'})).toBeVisible();
 const keyLeak=await page.request.get('/api/slots');expect(keyLeak.ok()).toBeTruthy();expect(keyLeak.headers()['x-api-key']).toBeUndefined();
 await page.locator('button.slot').first().click();
 await page.getByLabel('Full name').fill('Browser Test Patient');await page.getByLabel('Email address').fill('browser@example.com');
 await page.getByRole('button',{name:'Confirm appointment'}).click();await expect(page.getByRole('heading',{name:'Your visit is booked.'})).toBeVisible();
 const reference=await page.locator('.ticket code').innerText();
 const token=await page.evaluate(()=>localStorage.getItem('carewell-patient-token'));
 const nested=await page.request.get(`/api/bookings/${reference}?id=${reference}`,{headers:{'X-Patient-Token':token!}});
 expect(nested.status()).toBe(200);
 expect((await nested.json()).data.id).toBe(reference);
 await page.reload();await page.getByRole('button',{name:'My appointments',exact:true}).click();
 await expect(page.locator('.booking').filter({hasText:reference})).toBeVisible();
 await page.getByLabel('Look up a booking').fill(reference);await page.getByRole('button',{name:'Find booking'}).click();
 await expect(page.locator('.ticket code')).toHaveText(reference);
 await page.getByRole('button',{name:'View my appointments'}).click();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('.booking').filter({hasText:reference}).getByRole('button',{name:'Cancel visit'}).click();
 await expect(page.locator('.booking').filter({hasText:reference}).locator('.badge')).toHaveText('cancelled');
 const cancelled=await page.request.delete(`/api/bookings/${reference}?id=${reference}`,{headers:{'X-Patient-Token':token!}});
 expect(cancelled.status()).toBe(200);
 expect((await cancelled.json()).data.status).toBe('cancelled');
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

test('A platform text error displays a useful message instead of a JSON parser error',async({page})=>{
 await page.route('**/api/slots?*',route=>route.fulfill({status:404,contentType:'text/plain',body:'The page could not be found\nNOT_FOUND'}));
 await page.goto('/');
 await expect(page.getByRole('alert')).toContainText('The booking service returned an unexpected response. Please try again.');
});
