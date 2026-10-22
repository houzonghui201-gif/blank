import {createHmac} from 'node:crypto';

export function settings(env = process.env) {
  const secret = env.APP_SECRET || '';
  if (Buffer.byteLength(secret) < 32) throw new Error('APP_SECRET must contain at least 32 bytes; use a randomly generated secret.');
  const digest = label => createHmac('sha256', secret).update(label).digest();
  const bytes = digest('vless-user-v1').subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const host = env.PUBLIC_HOST || env.RENDER_EXTERNAL_HOSTNAME || '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host)) {
    throw new Error('A valid PUBLIC_HOST or RENDER_EXTERNAL_HOSTNAME is required.');
  }
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 10001) throw new Error('PORT must be 1024..65535, except 10001.');
  const wsPath = '/ws/' + digest('ws-path-v1').toString('hex').slice(0, 32);
  const token = digest('subscription-v1').toString('base64url');
  const params = new URLSearchParams({encryption:'none',security:'tls',type:'ws',host,sni:host,path:wsPath,alpn:'http/1.1'});
  const name = env.NODE_NAME || 'Personal-Xray';
  const nodeUri = `vless://${uuid}@${host}:443?${params}#${encodeURIComponent(name)}`;
  return {uuid, host, port, wsPath, token, name, nodeUri, subscriptionUrl:`https://${host}/sub/${token}`};
}

export function xrayConfig(s) {
  return {
    log:{loglevel:'warning',access:'none'},
    inbounds:[{
      tag:'vless-ws',listen:'127.0.0.1',port:10001,protocol:'vless',
      settings:{clients:[{id:s.uuid}],decryption:'none'},
      streamSettings:{network:'ws',security:'none',wsSettings:{path:s.wsPath}}
    }],
    outbounds:[
      {tag:'direct',protocol:'freedom',settings:{domainStrategy:'UseIP'}},
      {tag:'blocked',protocol:'blackhole',settings:{}}
    ],
    routing:{domainStrategy:'IPIfNonMatch',rules:[
      {type:'field',ip:['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.168.0.0/16','198.18.0.0/15','224.0.0.0/4','240.0.0.0/4','::/128','::1/128','fc00::/7','fe80::/10','ff00::/8'],outboundTag:'blocked'},
      {type:'field',port:'25,465,587',outboundTag:'blocked'}
    ]}
  };
}
