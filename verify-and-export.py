#!/usr/bin/env python3
"""Verify a live subscription using a real Xray client, then generate QR images."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit, parse_qs, quote, unquote
from urllib.request import urlopen
from uuid import UUID


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--subscription-url', default=os.getenv('SUBSCRIPTION_URL'))
    parser.add_argument('--xray', default=os.getenv('XRAY_BIN') or shutil.which('xray'))
    parser.add_argument('--output', default='verified-output')
    args = parser.parse_args()
    if not args.subscription_url or not args.xray:
        parser.error('Provide SUBSCRIPTION_URL and XRAY_BIN, or their command-line equivalents.')
    endpoint = urlsplit(args.subscription_url)
    if endpoint.scheme != 'https' or not endpoint.hostname or endpoint.username or endpoint.password:
        parser.error('The subscription endpoint must be a public HTTPS URL.')
    import qrcode  # pip install -r requirements-verifier.txt
    with urlopen(args.subscription_url, timeout=90) as response:
        if urlsplit(response.url).scheme != 'https':
            raise RuntimeError('Subscription downgraded from HTTPS.')
        raw = response.read(65537)
    if len(raw) > 65536:
        raise RuntimeError('Unexpectedly large subscription.')
    uri = base64.b64decode(raw, validate=True).decode().strip()
    parsed = urlsplit(uri)
    query = {k:v[0] for k,v in parse_qs(parsed.query).items()}
    if parsed.scheme != 'vless' or not parsed.hostname or not parsed.username:
        raise RuntimeError('Expected one VLESS node.')
    UUID(parsed.username)
    if query.get('type') != 'ws' or query.get('security') != 'tls' or query.get('encryption') != 'none':
        raise RuntimeError('Expected VLESS + WebSocket + TLS.')
    if query.get('allowInsecure', '0') not in ('0', 'false'):
        raise RuntimeError('Insecure certificate verification is not accepted.')
    if parsed.hostname != endpoint.hostname or query.get('sni',parsed.hostname) != endpoint.hostname:
        raise RuntimeError('Node host and subscription host do not match.')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0))
        port = probe.getsockname()[1]
    cfg = {
        'log':{'loglevel':'none'},
        'inbounds':[{'listen':'127.0.0.1','port':port,'protocol':'socks','settings':{'auth':'noauth','udp':False}}],
        'outbounds':[{'protocol':'vless','settings':{'vnext':[{'address':parsed.hostname,'port':parsed.port or 443,'users':[{'id':parsed.username,'encryption':'none'}]}]},
                      'streamSettings':{'network':'ws','security':'tls','tlsSettings':{'serverName':query.get('sni',parsed.hostname),'allowInsecure':False,'alpn':['http/1.1']},
                                        'wsSettings':{'path':query['path'],'host':query.get('host',parsed.hostname)}}}]
    }
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='xray-verifier-') as td:
        config = Path(td)/'client.json'
        config.write_text(json.dumps(cfg))
        config.chmod(0o600)
        subprocess.run([args.xray,'run','-test','-config',str(config)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        process = subprocess.Popen([args.xray,'run','-config',str(config)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                if process.poll() is not None:
                    raise RuntimeError('Xray client stopped unexpectedly.')
                try:
                    with socket.create_connection(('127.0.0.1',port),timeout=0.2): break
                except OSError: time.sleep(0.1)
            else: raise RuntimeError('Xray client did not become ready.')
            command = ['curl','--fail','--silent','--show-error','--max-time','30','--proxy',f'socks5h://127.0.0.1:{port}','--noproxy','','https://example.com/']
            result = subprocess.run(command,check=True,capture_output=True,timeout=35)
            if b'Example Domain' not in result.stdout:
                raise RuntimeError('Unexpected HTTPS response through the VLESS tunnel.')
        finally:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
    # Only after a successful PUBLIC TLS + WS + VLESS + outbound HTTPS round trip.
    out = Path(args.output)
    out.mkdir(parents=True,exist_ok=True,mode=0o700)
    subscription_import = 'sub://' + base64.b64encode(args.subscription_url.encode()).decode() + '#' + quote(unquote(parsed.fragment or 'Personal-Xray'))
    outputs = {'subscription-url.txt':args.subscription_url,'subscription-import.txt':subscription_import,'vless-node.txt':uri}
    for filename, value in outputs.items():
        path = out/filename
        path.write_text(value+'\n'); path.chmod(0o600)
    for filename, value in [('subscription-qr.png',subscription_import),('node-qr.png',uri)]:
        path = out/filename
        qrcode.make(value).save(path); path.chmod(0o600)
    report = {'status':'passed','checked_at_utc':datetime.now(timezone.utc).isoformat(),'endpoint_host':endpoint.hostname,
              'checks':['HTTPS subscription','TLS certificate verification enabled','WebSocket + VLESS authentication','HTTPS example.com through Xray SOCKS outbound'],
              'elapsed_seconds':round(time.monotonic()-started,2),'limitation':'Verified from the test machine, not the user phone or home network.'}
    (out/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    print(f'Exported QR images and import links to {out.resolve()}')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        raise SystemExit(f'FAILED: {type(error).__name__}. No successful verification claimed; check endpoint and runtime logs.') from None
