const http=require('http'),fs=require('fs'),path=require('path'),url=require('url'),os=require('os');
const root='dist';
const port=8088;
http.createServer((req,res)=>{
  const u=url.parse(req.url);
  let name=u.pathname==='/'?'':decodeURIComponent(u.pathname.slice(1));
  let fp=path.resolve(root, name||'');
  if(fp.indexOf(path.resolve(root))!==0){res.writeHead(403);return res.end('Forbidden')}
  fs.stat(fp,(e,s)=>{
    if(e){res.writeHead(404);return res.end('Not Found')}
    if(s.isDirectory()){
      const items=fs.readdirSync(fp).map(f=>{
        const st=fs.statSync(path.join(fp,f));
        const sz=st.isDirectory()?'📁':(st.size/1024/1024).toFixed(1)+' MB';
        return '<li><a href="'+encodeURI(f)+'">'+f+'</a> '+sz+'</li>';
      }).join('');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      return res.end('<!doctype html><meta charset="utf-8"><title>绿角犀 Office 下载</title><h1>📦 绿角犀 Office 1.1.1</h1><h3>点击下载：</h3><ul style="font-size:18px;line-height:2">'+items+'</ul><hr><p style="color:#888">局域网文件服务器 · 用完 Ctrl+C 关掉</p>');
    }
    const base=path.basename(fp);
    res.writeHead(200,{'Content-Length':s.size,'Content-Disposition':'attachment; filename="'+base+'"'});
    fs.createReadStream(fp).pipe(res);
  });
}).listen(port,'0.0.0.0',()=>{
  const ifs=os.networkInterfaces();
  const ips=[];
  for(const k in ifs) for(const a of ifs[k]) if(a.family==='IPv4'&&!a.internal) ips.push(a.address);
  console.log('='.repeat(50));
  console.log('🚀 绿角犀 Office 1.1.1 下载服务器已启动');
  console.log('='.repeat(50));
  console.log('本机:   http://localhost:'+port);
  for(const ip of ips) console.log('局域网: http://'+ip+':'+port);
  console.log('='.repeat(50));
});
