export class HttpError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function requireThat(condition,message,status=400){if(!condition)throw new HttpError(message,status);}
export const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function errorResponse(e){if(!(e instanceof HttpError))console.error('Request failed',e.message);return json({error:e instanceof HttpError?e.message:'服务暂时不可用，请重试'},e.status||500);}
export async function body(request){
 requireThat((request.headers.get('content-type')||'').includes('application/json'),'需要 JSON 请求',415);
 const reader=request.body?.getReader();if(!reader)return {};let n=0;const chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>16384){await reader.cancel();throw new HttpError('请求过大',413);}chunks.push(value);}
 const bytes=new Uint8Array(n);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
 try{const b=JSON.parse(new TextDecoder().decode(bytes));requireThat(b&&typeof b==='object'&&!Array.isArray(b),'参数无效');return b;}catch(e){throw new HttpError('无效 JSON');}
}
export const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
export const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha=async s=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
export async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return 'pbkdf2-100000:' + hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:unhex(salt)},key,256)));
}
export function equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export async function encrypt(value,secret){
 requireThat(secret,'服务端尚未配置密钥加密',503);
 const key=await crypto.subtle.importKey('raw',unhex(await sha(secret)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
 return hex(iv)+':'+hex(new Uint8Array(data));
}
export async function decrypt(value,secret){
 requireThat(secret,'服务端尚未配置密钥加密',503);
 const [iv,data]=String(value).split(':');
 requireThat(/^[a-f0-9]{24}$/.test(iv)&&/^[a-f0-9]+$/.test(data||''),'保存的密钥无效，请重新设置',400);
 try{
  const key=await crypto.subtle.importKey('raw',unhex(await sha(secret)),'AES-GCM',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(iv)},key,unhex(data)));
 }catch{throw new HttpError('无法解密 API 密钥，请在设置中重新保存',400);}
}
