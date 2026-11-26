    const statusNode=document.getElementById("status");
    function fail(message){statusNode.hidden=false;statusNode.textContent=message}
    const documentParams=new URLSearchParams(location.search);
    const documentGrants=/^[a-f0-9]{64}(,[a-f0-9]{64})*$/.test(documentParams.get("grants")||"")?documentParams.get("grants"):"";
    function grantUrl(source){const url=new URL(source,location.href);if(documentGrants&&url.origin===location.origin)url.searchParams.set("grants",documentGrants);return url.href}
    async function json(path){const response=await fetch(path,{headers:documentGrants?{"X-Content-Grants":documentGrants}:{}});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error||`请求失败（${response.status}）`);return data}
    function loadMammoth(){
      if(window.mammoth)return Promise.resolve(window.mammoth);
      return new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/mammoth@1.10.0/mammoth.browser.min.js";script.referrerPolicy="no-referrer";script.onload=()=>window.mammoth?resolve(window.mammoth):reject(new Error("Word 解析组件没有正确加载"));script.onerror=()=>reject(new Error("Word 解析组件加载失败，请检查网络或让站长上传 PDF 预览版本"));document.head.append(script)});
    }
    function sanitizedDocument(html){
      const template=document.createElement("template");template.innerHTML=String(html||"");
      // Create a fresh tree from the formatting we support. Never insert a
      // converted element or copy unknown attributes, namespaces or resource URLs.
      const allowed=new Set("p br strong b em i u s del sup sub code pre blockquote ul ol li h1 h2 h3 h4 h5 h6 a img table thead tbody tfoot tr th td span div hr".split(" "));
      function copy(source,parent){
        for(const child of source.childNodes){
          if(child.nodeType===3){parent.append(document.createTextNode(child.textContent));continue}
          if(child.nodeType!==1||child.namespaceURI!=="http://www.w3.org/1999/xhtml"||!allowed.has(child.localName))continue;
          const tag=child.localName,node=document.createElement(tag);
          if(tag==="img"){
            const src=child.getAttribute("src")||"";
            if(!/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(src))continue;
            node.src=src;node.alt=child.getAttribute("alt")||"";
          }else if(tag==="a"){
            const href=child.getAttribute("href")||"";
            if(/^https:\/\//i.test(href)||/^mailto:|^tel:/i.test(href)){
              node.setAttribute("href",href);node.setAttribute("target","_blank");node.setAttribute("rel","noopener noreferrer");
            }else if(/^#[a-z0-9_-]+$/i.test(href))node.setAttribute("href","#doc-"+href.slice(1));
          }
          const id=child.getAttribute("id")||"";
          if(/^[a-z0-9_-]{1,120}$/i.test(id))node.id="doc-"+id;
          for(const attr of ["colspan","rowspan"]){
            const value=child.getAttribute(attr);if((tag==="td"||tag==="th")&&/^[1-9][0-9]?$/.test(value||""))node.setAttribute(attr,value);
          }
          copy(child,node);parent.append(node);
        }
      }
      const output=document.createDocumentFragment();copy(template.content,output);return output;
    }
    async function start(){
      const assetId=new URLSearchParams(location.search).get("asset")||"";
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(assetId)){fail("文档地址无效。");return}
      try{
        const studio=documentParams.get("studio")==="1";
        const bootstrap=await json(studio?"/api/admin/assets":"/api/bootstrap");
        const candidates=studio?bootstrap:[...(bootstrap.assets||[]),...(bootstrap.articleAssets||[]),...(bootstrap.sectionAssets||[]),...(bootstrap.galleryAssets||[])];
        const asset=candidates.find(item=>item.id===assetId);
        if(!asset)throw new Error("文档不存在，或当前账号没有访问权限");
        document.getElementById("title").textContent=asset.display_name;document.title=`${asset.display_name} · 星月集`;
        document.getElementById("meta").textContent=`WORD · ${(Number(asset.size_bytes)/1024/1024).toFixed(2)} MiB`;
        const download=document.getElementById("download");if(asset.downloadUrl){download.href=grantUrl(asset.downloadUrl);download.style.display="inline-flex"}
        if(!studio && !asset.canDownload)throw new Error("未开放 Word 原件下载，请选择站长提供的 PDF 预览版。");
        if(!/\.docx$/i.test(asset.filename||""))throw new Error("旧版 .doc 无法在浏览器中安全解析，请下载原件，或让站长在 Studio 上传 PDF 预览版本。");
        const [mammoth,response]=await Promise.all([loadMammoth(),fetch(grantUrl(asset.url))]);if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error||`文档读取失败（${response.status}）`)}
        const result=await mammoth.convertToHtml({arrayBuffer:await response.arrayBuffer()});
        const documentNode=document.getElementById("document");documentNode.replaceChildren(sanitizedDocument(result.value));statusNode.hidden=true;
        if(result.messages?.length)console.info("Word preview conversion notes",result.messages);
      }catch(error){fail(error.message)}
    }
    start();
