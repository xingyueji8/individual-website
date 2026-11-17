// Build an unlinked, synthetic-only browser fixture for the deployed HTTPS site.
// Remove public/pdf-render-check.html after visual/download verification.
import { readFile, writeFile } from "node:fs/promises";
const index = await readFile("public/index.html", "utf8");
const css = index.match(/<style>([\s\S]*?)<\/style>/)[1];
const watermark = index.slice(index.indexOf("    function createPdfWatermarkDataUrl("), index.indexOf("    async function downloadCurrentContentPdf("));
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>PDF 渲染核验</title>
<style>${css}</style><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/vnext.css"><link rel="stylesheet" href="/material.css"><link rel="stylesheet" href="/personal-space.css">
<style>body{overflow:auto;padding:24px}.check-controls{position:relative;z-index:2;background:white;color:#17262c;padding:24px;border:1px solid #bcc;max-width:900px;margin:auto}.check-controls label{display:inline-block;margin:12px}.check-controls select,.check-controls button{font:inherit;padding:10px}#result{white-space:pre-wrap}#reader-dialog .reader-wrap{padding:24px}#reader-dialog img{max-width:100%;height:auto}</style>
<script src="/pdf-engine.js"></script><script src="/article-pdf.js?v=20261118-paginated-check"></script></head><body>
<section class="check-controls"><h1>PDF 渲染核验</h1><p>仅生成合成测试图片，不读取账号或网站作品。</p><label>测试内容 <select id="case"><option value="short">短文：2 张图片</option><option value="long">长文：36 张竖图</option></select></label><label>渲染方式 <select id="mode"><option value="paged">逐页渲染</option><option value="legacy">原整篇画布</option></select></label><label><input type="checkbox" id="modal" checked>保留文章阅读弹窗</label><button id="run" type="button">生成并下载核验 PDF</button><p id="result" role="status">等待开始</p></section>
<dialog id="reader-dialog" class="reader-dialog"><div class="reader-wrap"><button id="close-reader">关闭阅读器</button><h2>合成文章阅读弹窗</h2><p>导出副本放在正文之外，与主站导出方式一致。</p></div></dialog>
<script>
${watermark}
const node=id=>document.getElementById(id);let running=false;
node('close-reader').onclick=()=>node('reader-dialog').close();
function image(){const c=document.createElement('canvas');c.width=600;c.height=1500;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,600,1500);g.addColorStop(0,'#09a7d2');g.addColorStop(.5,'#f6ae34');g.addColorStop(1,'#ce2867');x.fillStyle=g;x.fillRect(0,0,600,1500);x.fillStyle='#112f42';x.fillRect(60,100,480,160);x.fillStyle='white';x.font='bold 68px sans-serif';x.fillText('PHOTO',180,210);return c.toDataURL('image/jpeg',.85)}
node('run').onclick=async()=>{if(running)return;running=true;node('run').disabled=true;let root;const stats=[];try{
const count=node('case').value==='long'?36:2;const mode=node('mode').value;
root=document.createElement('article');root.className='pdf-export';const title=document.createElement('h1');title.textContent='合成图文 PDF 核验 '+count+' 张';root.append(title);
const body=document.createElement('div');body.className='reader-body pdf-body';const src=image();for(let i=0;i<count;i++){const p=document.createElement('p');p.textContent='第 '+(i+1)+' 张测试图片，下方应显示蓝、黄、红渐变。';const img=document.createElement('img');img.src=src;img.alt='PHOTO '+(i+1);body.append(p,img)}root.append(body);document.body.append(root);
if(node('modal').checked&&!node('reader-dialog').open)node('reader-dialog').showModal();
node('result').textContent='正在准备图片';await XYJArticlePdf.prepareImages(root);
const record=(canvas,page,total,ink)=>{let color=0;try{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;for(let i=0;i<pixels.length;i+=64)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>40)color++}catch(error){stats.push({error:error.message})}stats.push({page,total,width:canvas.width,height:canvas.height,colored:color,ink});node('result').textContent=JSON.stringify(stats)};
const options={margin:[12,12,14,12],filename:'pdf-'+mode+'-'+count+'.pdf',image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'},pagebreak:{mode:['css','legacy'],avoid:['img','pre','blockquote','table']}};
let pdf;if(mode==='paged')pdf=await XYJArticlePdf.render(root,options,{onCanvas:record});else{options.html2canvas.onrendered=c=>record(c,1,1,true);pdf=await html2pdf().set(options).from(root).toPdf().get('pdf')}
applyPdfWatermark(pdf);await pdf.save(options.filename);node('result').textContent='完成 '+pdf.internal.getNumberOfPages()+' 页\u005cn'+JSON.stringify(stats);node('result').dataset.done='1';
}catch(error){node('result').textContent='失败：'+error.stack;node('result').dataset.error='1';}finally{root?.remove();if(node('reader-dialog').open)node('reader-dialog').close();running=false;node('run').disabled=false;}};
</script></body></html>`;
await writeFile("public/pdf-render-check.html", html);
console.log("Prepared public/pdf-render-check.html (synthetic content only)");
