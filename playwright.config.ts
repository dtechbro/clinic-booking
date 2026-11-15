import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',workers:1,use:{baseURL:'http://127.0.0.1:4173',headless:true,launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}},
 webServer:[
  {command:'npm start -w backend',url:'http://127.0.0.1:3001/health',reuseExistingServer:!process.env.CI},
  {command:'node --env-file=frontend/.env --import tsx scripts/preview.ts',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI}
 ]
});
