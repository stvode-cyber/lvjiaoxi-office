const http = require('http');
const WebSocket = require('ws');
function tg(){return new Promise((res,rej)=>{http.get('http://127.0.0.1:9222/json/list',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))}).on('error',rej)})}
(async()=>{
  const targets=await tg();
  const page=targets.find(t=>t.type==='page');
  const cdp=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r=>cdp.on('open',r));
  let seq=10;
  function e(expr){return new Promise(res=>{const id=++seq;const h=m=>{const msg=JSON.parse(m);if(msg.id===id){cdp.removeListener('message',h);res(msg.result&&msg.result.result?msg.result.result.value:'ERR:'+JSON.stringify(msg.result))}};cdp.on('message',h);cdp.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true}}))})}

  // 分步骤跑 buildXlsx
  const r1 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; return "doc ok: " + JSON.stringify(doc).slice(0,80); } catch(err) { return "ERR:" + err.message; } })()');
  console.log('step1 doc:', r1);

  const r2 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; var zip = window.OS.Exporter.buildXlsx(doc); return "zip ok, keys=" + Object.keys(zip).join(","); } catch(err) { return "ERR:" + err.message + " at " + err.stack; } })()');
  console.log('step2 buildXlsx:', r2);

  const r3 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; var zip = window.OS.Exporter.buildXlsx(doc); var files = Object.keys(zip.files); return files.join("|"); } catch(err) { return "ERR:" + err.message; } })()');
  console.log('step3 file list:', r3);

  if (r3.indexOf('ERR') !== 0) {
    const r4 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; var zip = window.OS.Exporter.buildXlsx(doc); return "hasCommentXML=" + !!zip.files["xl/comments/comment1.xml"]; } catch(err) { return "ERR:" + err.message; } })()');
    console.log('step4 has cmt:', r4);

    const r5 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; var zip = window.OS.Exporter.buildXlsx(doc); return "cmtXml=" + (zip.files["xl/comments/comment1.xml"] ? zip.files["xl/comments/comment1.xml"].async(function(){return 0;})().slice(0,400) : "NONE"); } catch(err) { return "ERR:" + err.message; } })()');
    console.log('step5 cmt xml:', r5);

    const r6 = await e('(function(){ try { var doc = {name:"test", data:{ cells:{A1:{v:"hi"}}, comments:[{id:"cmt1",ref:"A1",sheet:0,author:"me",createdAt:1,resolved:false,replies:[{author:"me",text:"hello",createdAt:1}]}] }}; var zip = window.OS.Exporter.buildXlsx(doc); var sx = zip.files["xl/worksheets/sheet1.xml"] ? zip.files["xl/worksheets/sheet1.xml"].async(function(){return 0;})() : ""; return "hasLegacyDrawing=" + sx.indexOf("legacyDrawing") + "; cts=" + zip.files["[Content_Types].xml"].async(function(){return 0;})().indexOf("spreadsheetml.comments") + "; rels=" + zip.files["xl/worksheets/_rels/sheet1.xml.rels"].async(function(){return 0;})().indexOf("comments"); } catch(err) { return "ERR:" + err.message; } })()');
    console.log('step6 check flags:', r6);
  }

  cdp.close();
  process.exit(0);
})();
