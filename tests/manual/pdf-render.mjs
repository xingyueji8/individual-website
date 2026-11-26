// Build a synthetic browser fixture using the actual article download handler.
// It is served only by this loopback preview, never by the production build.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { buildWeb } from "../../scripts/build-web.mjs";
await buildWeb();
const index = await readFile("dist/public/index.html", "utf8");
const css = index.match(/<style>([\s\S]*?)<\/style>/)[1];
const exportScript = index.slice(index.indexOf("    function pdfFilename("), index.indexOf("    /* ---------- 09."));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>PDF 导出核验</title>
<style>${css}</style><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/vnext.css"><link rel="stylesheet" href="/material.css"><link rel="stylesheet" href="/article-pdf.css?v=20261118-pdf-quality">
<style>body{overflow:auto;padding:24px}.check-controls{background:white;color:#17262c;padding:24px;border:1px solid #bcc;max-width:900px;margin:auto}.check-controls label{display:inline-block;margin:12px}.check-controls select,.check-controls button{font:inherit;padding:10px}#reader-dialog .reader-wrap{padding:24px}#result{white-space:pre-wrap}</style>
<script src="/pdf-engine.js"></script><script src="/article-pdf.js?v=20261118-pdf-quality"></script></head><body>
<section class="check-controls"><h1>PDF 导出核验</h1><p>仅使用合成测试图片，不读取账号或网站作品。</p><label>测试内容 <select id="case"><option value="2">短文：2 张图片</option><option value="18" selected>长文：18 张竖图</option></select></label><button id="open" type="button">打开测试文章</button><p id="result" role="status">等待开始</p></section>
<dialog id="reader-dialog" class="reader-dialog"><div class="reader-wrap"><button id="close-reader" class="btn ghost" type="button">关闭阅读器</button><h2>合成图文测试文章</h2><p>导出副本放在正文之外，与主站导出方式一致。</p><button class="btn" id="content-pdf" type="button">下载 PDF</button></div></dialog>
<script>
const node=id=>document.getElementById(id);
const state={currentContent:{id:"synthetic-test",canDownload:true}};
const ensurePdfLibrary=async()=>{};
const enhanceArticleLinks=()=>{};
const mediaIdFromUrl=()=>null;
const contentTimeLabels=()=>({published:"发布时间：测试文章",updated:"更新时间：测试文章"});
const showAuthLock=()=>{throw new Error("意外的权限提示");};
let article, ratio, startedAt, result;
const api=async()=>article;
const real=globalThis.XYJArticlePdf;
globalThis.XYJArticlePdf={
  ...real,
  chooseImageRatio:async root=>{
    ratio=await real.chooseImageRatio(root);
    startedAt=performance.now();
    return ratio;
  },
  render:async(...args)=>{
    const pdf=await real.render(...args),save=pdf.save.bind(pdf);
    pdf.save=()=>{
      const saved=save("xyj-pdf-"+Math.round(ratio*100)+"-"+node("case").value+".pdf");
      result={ratio,pages:pdf.internal.getNumberOfPages(),seconds:Number(((performance.now()-startedAt)/1000).toFixed(2))};
      return saved;
    };
    return pdf;
  },
};
${exportScript}
function photo(index){
  const canvas=document.createElement("canvas");canvas.width=900;canvas.height=1600;
  const ctx=canvas.getContext("2d"),g=ctx.createLinearGradient(0,0,900,1600);
  g.addColorStop(0,"#098dc2");g.addColorStop(.5,"#f6ae34");g.addColorStop(1,"#ce2867");
  ctx.fillStyle=g;ctx.fillRect(0,0,900,1600);
  for(let y=0;y<32;y++){for(let x=0;x<18;x++){ctx.fillStyle="hsla("+((27*x+19*y+8*index)%360)+",70%,45%,0.15)";ctx.fillRect(x*50,y*50,50,50);}}
  ctx.fillStyle="#142d3b";ctx.fillRect(100,128,700,170);ctx.fillStyle="white";ctx.font="bold 90px sans-serif";ctx.fillText("PHOTO "+(index+1),190,242);
  const url=canvas.toDataURL("image/jpeg",.9);canvas.width=canvas.height=0;return url;
}
node("open").onclick=()=>{
  const count=Number(node("case").value);
  if(article?.count!==count){
    const body=Array.from({length:count},(_,i)=>'<p>第 '+(i+1)+' 张测试照片。请确认图像完整、编号顺序正确。</p><img alt="PHOTO '+(i+1)+'" src="'+photo(i)+'">').join("");
    article={...state.currentContent,count,title:"合成图文核验 "+count+" 张",body_html:body,inlineMedia:[]};
  }
  node("reader-dialog").showModal();
};
node("close-reader").onclick=()=>node("reader-dialog").close();
node("content-pdf").onclick=async event=>{
  const button=event.currentTarget;
  result=null;
  const ok=await downloadCurrentContentPdf(button);
  node("result").textContent=ok?"已完成 "+JSON.stringify(result):"未下载";
  if(ok)node("reader-dialog").close();
};
</script></body></html>`;
const assets = new Set(["/theme.css", "/vnext.css", "/material.css", "/article-pdf.css", "/pdf-engine.js", "/article-pdf.js"]);
const port = Number(process.env.PDF_PREVIEW_PORT || 8789);
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  } else if (assets.has(path)) {
    const type = path.endsWith(".css") ? "text/css" : "text/javascript";
    response.writeHead(200, { "Content-Type": type + "; charset=utf-8" });
    response.end(await readFile("dist/public" + path));
  } else {
    response.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.log(`PDF preview: http://127.0.0.1:${port}/`));
