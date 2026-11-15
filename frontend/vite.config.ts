import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,process.cwd(),'');
 return {plugins:[react()],server:{proxy:{'/api':{target:env.API_URL || 'http://127.0.0.1:3001',changeOrigin:true,configure(proxy){proxy.on('proxyReq',(proxyReq,req)=>{proxyReq.setHeader('X-API-Key',env.API_KEY || '');proxyReq.setHeader('X-Client-IP',req.socket.remoteAddress || 'local');});}}}}};
});
