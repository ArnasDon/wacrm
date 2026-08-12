'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, ImageIcon, Loader2, PackageSearch, Plus, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DatabaseIntegrations } from '@/components/settings/database-integrations'

type Product = { id:string; name:string; description:string|null; color:string|null; price:number|string; currency:string; image_url:string|null; product_url:string|null; category:string|null; stock_quantity:number|null; is_active:boolean }
type Source = { id:string; name:string; source_type:string; base_url:string|null; search_path:string|null; auth_type:string; is_active:boolean }
type DatabaseStats = { totalProductRecords:number; totalVariantRecords:number; sources:Array<{sourceId:string;sourceName:string;ok:boolean;productRecords:number;variantRecords:number;tables:Array<{table:string;kind:string;count:number}>;error?:string}> }
// Bulk uploader: each photo gets uploaded then classified by AI (category,
// colour + description) as a *suggestion* — name and price are never guessed,
// the owner always fills those in before saving.
type BulkItem = { id:string; file:File; imageUrl:string|null; uploading:boolean; classifying:boolean; name:string; price:string; category:string|null; color:string|null; description:string; error?:string }

const initialProduct = { name:'', price:'', currency:'MZN', image_url:'', description:'', category:'', product_url:'', stock_quantity:'' }
const initialSource = { name:'', base_url:'', search_path:'products?search={query}&limit={limit}', auth_type:'none', auth_header:'X-API-Key', auth_secret:'', field_mapping: JSON.stringify({ items:'data.products', id:'id', name:'name', description:'description', price:'price', currency:'currency', imageUrl:'images.0.url', productUrl:'url', category:'category.name', stockQuantity:'stock' }, null, 2) }

// Shows what the AI classified (category + colour + description) with an
// inline edit mode — the AI should usually get it right, but the owner can
// correct every suggested field.
function ProductCard({p,onToggle,onRemove,onSave}:{p:Product;onToggle:()=>void;onRemove:()=>void;onSave:(patch:{category?:string|null;color?:string|null;description?:string|null})=>void}){
  const [editing,setEditing]=useState(false)
  const [category,setCategory]=useState(p.category??'')
  const [color,setColor]=useState(p.color??'')
  const [description,setDescription]=useState(p.description??'')
  function startEditing(){ setCategory(p.category??''); setColor(p.color??''); setDescription(p.description??''); setEditing(true) }

  return <Card className={!p.is_active?'opacity-60':''}>
    {p.image_url?<img src={p.image_url} alt={p.name} className="aspect-[4/3] w-full object-cover"/>:<div className="flex aspect-[4/3] items-center justify-center bg-muted"><ImageIcon className="h-10 w-10"/></div>}
    <CardHeader><CardTitle>{p.name}</CardTitle><CardDescription>{p.category||'Sem categoria'}{p.color?` · ${p.color}`:''}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-lg font-semibold">{Number(p.price).toLocaleString('pt-PT')} {p.currency}</p>
      {editing?<div className="space-y-2">
        <Input placeholder="Categoria" value={category} onChange={e=>setCategory(e.target.value)}/>
        <Input placeholder="Cor" value={color} onChange={e=>setColor(e.target.value)}/>
        <Textarea placeholder="Descrição" value={description} onChange={e=>setDescription(e.target.value)}/>
        <div className="flex gap-2"><Button size="sm" onClick={()=>{onSave({category:category.trim()||null,color:color.trim()||null,description:description.trim()||null});setEditing(false)}}>Guardar</Button><Button size="sm" variant="ghost" onClick={()=>setEditing(false)}>Cancelar</Button></div>
      </div>:<p className="line-clamp-3 text-sm text-muted-foreground">{p.description||'Sem descrição — usa "Reclassificar tudo com IA" ou edita à mão.'}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onToggle}>{p.is_active?'Desactivar':'Activar'}</Button>
        {!editing?<Button size="sm" variant="outline" onClick={startEditing}>Editar</Button>:null}
        <Button size="sm" variant="destructive" onClick={onRemove}><Trash2/>Remover</Button>
        {p.product_url?<Button size="sm" variant="ghost" render={<a href={p.product_url} target="_blank" rel="noreferrer"/>}><ExternalLink/>Abrir</Button>:null}
      </div>
    </CardContent>
  </Card>
}

export default function CatalogPage() {
  const [products,setProducts]=useState<Product[]>([]); const [sources,setSources]=useState<Source[]>([])
  const [databaseStats,setDatabaseStats]=useState<DatabaseStats>({totalProductRecords:0,totalVariantRecords:0,sources:[]})
  const [loading,setLoading]=useState(true); const [savingProduct,setSavingProduct]=useState(false); const [savingSource,setSavingSource]=useState(false); const [uploading,setUploading]=useState(false); const [testing,setTesting]=useState(false)
  const [productForm,setProductForm]=useState(initialProduct); const [sourceForm,setSourceForm]=useState(initialSource); const [preview,setPreview]=useState<Array<{id:string;name:string;price:number;currency:string;imageUrl?:string|null}>>([])
  const [bulkItems,setBulkItems]=useState<BulkItem[]>([]); const [bulkSaving,setBulkSaving]=useState(false)
  const [classifyingAll,setClassifyingAll]=useState(false)
  const [classifyProgress,setClassifyProgress]=useState<{current:number;total:number;label:string}|null>(null)

  const loadData=useCallback(async()=>{ setLoading(true); try { const [a,b,c]=await Promise.all([fetch('/api/catalog/products',{cache:'no-store'}),fetch('/api/catalog/sources',{cache:'no-store'}),fetch('/api/catalog/sources/stats',{cache:'no-store'})]); const pa=await a.json().catch(()=>({})); const pb=await b.json().catch(()=>({})); const pc=await c.json().catch(()=>({})); if(!a.ok) throw new Error(pa.error??'Não foi possível carregar os produtos.'); if(!b.ok&&b.status!==403) throw new Error(pb.error??'Não foi possível carregar as fontes.'); setProducts(pa.products??[]); setSources(pb.sources??[]); if(c.ok)setDatabaseStats({totalProductRecords:pc.totalProductRecords??0,totalVariantRecords:pc.totalVariantRecords??0,sources:pc.sources??[]}) } catch(e){ toast.error(e instanceof Error?e.message:'Erro ao carregar o catálogo.') } finally { setLoading(false) } },[])
  useEffect(()=>{void loadData()},[loadData])
  const activeProducts=useMemo(()=>products.filter(p=>p.is_active),[products])
  const apiSources=useMemo(()=>sources.filter(source=>source.source_type==='external_rest'),[sources])
  const databaseSources=useMemo(()=>sources.filter(source=>source.source_type==='external_supabase'),[sources])

  async function uploadImage(file:File){ setUploading(true); try { const form=new FormData(); form.append('file',file); const r=await fetch('/api/catalog/upload',{method:'POST',body:form}); const b=await r.json().catch(()=>({})); if(!r.ok) throw new Error(b.error??'Falha no carregamento.'); setProductForm(f=>({...f,image_url:b.url})); toast.success('Fotografia carregada.') } catch(e){ toast.error(e instanceof Error?e.message:'Erro no carregamento.') } finally { setUploading(false) } }
  async function submitProduct(e:FormEvent<HTMLFormElement>){ e.preventDefault(); setSavingProduct(true); try { const r=await fetch('/api/catalog/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(productForm)}); const b=await r.json().catch(()=>({})); if(!r.ok) throw new Error(b.error??'Não foi possível criar o produto.'); setProducts(c=>[b.product,...c]); setProductForm(initialProduct); toast.success('Produto adicionado.') } catch(err){ toast.error(err instanceof Error?err.message:'Erro ao criar produto.') } finally { setSavingProduct(false) } }
  async function removeProduct(id:string){ if(!confirm('Remover este produto?')) return; const r=await fetch(`/api/catalog/products/${id}`,{method:'DELETE'}); if(r.ok){setProducts(c=>c.filter(p=>p.id!==id));toast.success('Produto removido.')}else toast.error('Não foi possível remover o produto.') }

  async function addBulkFiles(files:FileList){
    const items:BulkItem[]=Array.from(files).map(file=>({id:crypto.randomUUID(),file,imageUrl:null,uploading:true,classifying:false,name:'',price:'',category:null,color:null,description:''}))
    setBulkItems(current=>[...current,...items])
    for(const item of items){
      try{
        const form=new FormData(); form.append('file',item.file)
        const r=await fetch('/api/catalog/upload',{method:'POST',body:form})
        const b=await r.json().catch(()=>({}))
        if(!r.ok) throw new Error(b.error??'Falha no carregamento.')
        setBulkItems(current=>current.map(x=>x.id===item.id?{...x,imageUrl:b.url,uploading:false,classifying:true}:x))
        const cr=await fetch('/api/catalog/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_url:b.url})})
        const cb=await cr.json().catch(()=>({}))
        setBulkItems(current=>current.map(x=>x.id===item.id?{...x,classifying:false,category:cr.ok?cb.category:null,color:cr.ok?cb.color:null,description:cr.ok?(cb.description??''):''}:x))
      }catch(e){
        setBulkItems(current=>current.map(x=>x.id===item.id?{...x,uploading:false,classifying:false,error:e instanceof Error?e.message:'Erro.'}:x))
      }
    }
  }
  function updateBulkItem(id:string,patch:Partial<BulkItem>){ setBulkItems(current=>current.map(x=>x.id===id?{...x,...patch}:x)) }
  function removeBulkItem(id:string){ setBulkItems(current=>current.filter(x=>x.id!==id)) }
  async function saveAllBulk(){
    const ready=bulkItems.filter(x=>x.imageUrl && x.name.trim() && x.price!=='' && Number(x.price)>=0)
    if(ready.length===0){ toast.error('Preenche nome e preço de pelo menos um produto.'); return }
    setBulkSaving(true)
    let saved=0
    for(const item of ready){
      try{
        const r=await fetch('/api/catalog/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:item.name,price:item.price,image_url:item.imageUrl,description:item.description,category:item.category,color:item.color})})
        const b=await r.json().catch(()=>({}))
        if(!r.ok) throw new Error(b.error??'Erro ao gravar.')
        setProducts(c=>[b.product,...c]); saved+=1
        setBulkItems(current=>current.filter(x=>x.id!==item.id))
      }catch(e){
        toast.error(`${item.name||'Produto'}: ${e instanceof Error?e.message:'erro'}`)
      }
    }
    setBulkSaving(false)
    if(saved>0) toast.success(`${saved} produto(s) adicionado(s).`)
  }
  async function toggleProduct(p:Product){ const r=await fetch(`/api/catalog/products/${p.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:!p.is_active})}); const b=await r.json().catch(()=>({})); if(r.ok)setProducts(c=>c.map(x=>x.id===p.id?b.product:x));else toast.error(b.error??'Não foi possível actualizar o produto.') }
  async function saveProductEdits(p:Product,patch:{category?:string|null;color?:string|null;description?:string|null}){ const r=await fetch(`/api/catalog/products/${p.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)}); const b=await r.json().catch(()=>({})); if(r.ok){setProducts(c=>c.map(x=>x.id===p.id?b.product:x));toast.success('Produto actualizado.')}else toast.error(b.error??'Não foi possível actualizar o produto.') }

  // Reclassifies every product that has a photo, AI-generated category,
  // colour + description overwriting whatever is there. The human can still
  // edit the three fields afterwards from the product card.
  async function classifyAllMissing(){
    const targets=products.filter(p=>p.image_url)
    if(targets.length===0){ toast.error('Nenhum produto com foto.'); return }
    setClassifyingAll(true)
    setClassifyProgress({current:0,total:targets.length,label:targets[0].name})
    let done=0
    for(const [index,p] of targets.entries()){
      setClassifyProgress({current:index+1,total:targets.length,label:p.name})
      try{
        const cr=await fetch('/api/catalog/classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_url:p.image_url})})
        const cb=await cr.json().catch(()=>({}))
        if(!cr.ok) throw new Error(cb.error??'Erro ao classificar.')
        const r=await fetch(`/api/catalog/products/${p.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:cb.category??null,color:cb.color??null,description:cb.description??''})})
        const b=await r.json().catch(()=>({}))
        if(r.ok){ setProducts(c=>c.map(x=>x.id===p.id?b.product:x)); done+=1 }
      }catch(e){
        console.error('[catalog] classify existing product failed:',p.id,e)
      }
    }
    setClassifyingAll(false); setClassifyProgress(null)
    if(done===targets.length) toast.success(`${done} de ${targets.length} produtos classificados. Categoria, cor e descrição foram actualizadas pela IA.`)
    else toast.success(`${done} de ${targets.length} produtos classificados. Os restantes falharam — tenta "Reclassificar tudo com IA" outra vez.`)
  }

  function mapping(){ try{return JSON.parse(sourceForm.field_mapping) as Record<string,unknown>}catch{throw new Error('O mapeamento deve ser JSON válido.')} }
  async function testSource(){ setTesting(true); try { const r=await fetch('/api/catalog/sources/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...sourceForm,source_type:'external_rest',field_mapping:mapping(),query:'produto'})}); const b=await r.json().catch(()=>({})); if(!r.ok) throw new Error(b.error??'Falha no teste.'); setPreview(b.products??[]); toast.success(`Ligação válida: ${b.products?.length??0} produto(s) reconhecido(s).`) } catch(e){ toast.error(e instanceof Error?e.message:'Falha no teste.') } finally { setTesting(false) } }
  async function submitSource(e:FormEvent<HTMLFormElement>){ e.preventDefault(); setSavingSource(true); try { const r=await fetch('/api/catalog/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...sourceForm,source_type:'external_rest',field_mapping:mapping()})}); const b=await r.json().catch(()=>({})); if(!r.ok) throw new Error(b.error??'Não foi possível ligar a API.'); setSources(c=>[b.source,...c]); setSourceForm(initialSource); setPreview([]); toast.success('Fonte externa ligada.') } catch(err){ toast.error(err instanceof Error?err.message:'Erro ao ligar a API.') } finally { setSavingSource(false) } }
  async function removeSource(id:string){ if(!confirm('Remover esta fonte externa?')) return; const r=await fetch(`/api/catalog/sources/${id}`,{method:'DELETE'}); if(r.ok){setSources(c=>c.filter(s=>s.id!==id));toast.success('Fonte removida.')}else toast.error('Não foi possível remover a fonte.') }
  async function toggleSource(s:Source){ const r=await fetch(`/api/catalog/sources/${s.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:!s.is_active})}); const b=await r.json().catch(()=>({})); if(r.ok)setSources(c=>c.map(x=>x.id===s.id?b.source:x));else toast.error(b.error??'Não foi possível actualizar a fonte.') }

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><PackageSearch className="h-6 w-6 text-primary"/><h1 className="text-2xl font-bold">Catálogo</h1></div><p className="mt-1 text-sm text-muted-foreground">Produtos internos, APIs e bases de dados externas usados pelo agente no WhatsApp.</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>{if(confirm('Isto substitui categoria, cor e descrição de TODOS os produtos com foto pela sugestão da IA. Continuar?'))void classifyAllMissing()}} disabled={classifyingAll} title="Substitui categoria, cor e descrição de todos os produtos com foto pela sugestão da IA"><Sparkles/>{classifyingAll?<Loader2 className="animate-spin"/>:null}Reclassificar tudo com IA</Button><Button variant="outline" onClick={()=>void loadData()} disabled={loading}>{loading?<Loader2 className="animate-spin"/>:<RefreshCw/>}Actualizar</Button></div></div>
    {classifyProgress?<Card size="sm"><CardContent className="space-y-2 py-3"><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-1.5 text-foreground"><Sparkles className="h-3.5 w-3.5"/>A classificar: {classifyProgress.label}</span><span className="tabular-nums text-muted-foreground">{classifyProgress.current} de {classifyProgress.total}</span></div><div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{width:`${Math.round((classifyProgress.current/classifyProgress.total)*100)}%`}}/></div></CardContent></Card>:null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card size="sm"><CardHeader><CardDescription>Produtos internos activos</CardDescription><CardTitle>{activeProducts.length}</CardTitle></CardHeader></Card><Card size="sm"><CardHeader><CardDescription>Produtos via base de dados</CardDescription><CardTitle>{loading?'—':databaseStats.totalProductRecords}</CardTitle></CardHeader></Card><Card size="sm"><CardHeader><CardDescription>Variantes via base de dados</CardDescription><CardTitle>{loading?'—':databaseStats.totalVariantRecords}</CardTitle></CardHeader></Card><Card size="sm"><CardHeader><CardDescription>Fontes externas</CardDescription><CardTitle>{sources.length}</CardTitle></CardHeader></Card></div>
    {databaseStats.sources.length>0?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{databaseStats.sources.map(stat=><Card key={stat.sourceId} size="sm"><CardHeader><CardDescription>{stat.sourceName}</CardDescription><CardTitle>{stat.ok?`${stat.productRecords} produto(s)`:'Indisponível'}</CardTitle></CardHeader><CardContent className="space-y-1 text-xs text-muted-foreground">{stat.ok?<>{stat.tables.map(table=><div key={`${stat.sourceId}:${table.table}`} className="flex justify-between gap-3"><span>{table.table}</span><span>{table.count}</span></div>)}<div className="flex justify-between gap-3 border-t pt-1"><span>Variantes</span><span>{stat.variantRecords}</span></div></>:<p>{stat.error??'Não foi possível consultar a fonte.'}</p>}</CardContent></Card>)}</div>:null}
    <Tabs defaultValue="products"><TabsList><TabsTrigger value="products">Produtos</TabsTrigger><TabsTrigger value="external">API externa{apiSources.length ? ` (${apiSources.length})` : ''}</TabsTrigger><TabsTrigger value="database">Base de dados{databaseSources.length ? ` (${databaseSources.length})` : ''}</TabsTrigger></TabsList>
      <TabsContent value="products" className="mt-4 space-y-6"><Card><CardHeader><CardTitle>Adicionar produto rápido</CardTitle><CardDescription>Nome e preço são obrigatórios.</CardDescription></CardHeader><CardContent><form onSubmit={submitProduct} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label>Nome</Label><Input required value={productForm.name} onChange={e=>setProductForm({...productForm,name:e.target.value})}/></div><div className="grid grid-cols-[1fr_90px] gap-2"><div className="space-y-2"><Label>Preço</Label><Input type="number" min="0" step="0.01" required value={productForm.price} onChange={e=>setProductForm({...productForm,price:e.target.value})}/></div><div className="space-y-2"><Label>Moeda</Label><Input value={productForm.currency} onChange={e=>setProductForm({...productForm,currency:e.target.value.toUpperCase()})}/></div></div>
        <div className="space-y-2 md:col-span-2"><Label>Fotografia</Label><div className="flex flex-col gap-2 sm:flex-row"><Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>{const f=e.target.files?.[0];if(f)void uploadImage(f)}}/><Input type="url" placeholder="ou cole uma URL pública" value={productForm.image_url} onChange={e=>setProductForm({...productForm,image_url:e.target.value})}/></div>{uploading?<p className="text-xs text-muted-foreground"><Upload className="mr-1 inline h-3 w-3"/>A carregar...</p>:null}</div>
        <div className="space-y-2"><Label>Categoria</Label><Input value={productForm.category} onChange={e=>setProductForm({...productForm,category:e.target.value})}/></div><div className="space-y-2"><Label>Stock</Label><Input type="number" min="0" value={productForm.stock_quantity} onChange={e=>setProductForm({...productForm,stock_quantity:e.target.value})}/></div><div className="space-y-2 md:col-span-2"><Label>Página do produto</Label><Input type="url" value={productForm.product_url} onChange={e=>setProductForm({...productForm,product_url:e.target.value})}/></div><div className="space-y-2 md:col-span-2"><Label>Descrição</Label><Textarea value={productForm.description} onChange={e=>setProductForm({...productForm,description:e.target.value})}/></div><div className="md:col-span-2"><Button type="submit" disabled={savingProduct||uploading}>{savingProduct?<Loader2 className="animate-spin"/>:<Plus/>}Adicionar produto</Button></div>
      </form></CardContent></Card>
      <Card><CardHeader><CardTitle>Adicionar vários produtos de uma vez</CardTitle><CardDescription>Escolhe várias fotos — a IA sugere categoria, cor e descrição para cada uma; tu só confirmas nome e preço antes de gravar.</CardDescription></CardHeader><CardContent className="space-y-4">
        <Input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>{const f=e.target.files;if(f&&f.length)void addBulkFiles(f)}}/>
        {bulkItems.length>0?<>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{bulkItems.map(item=><Card key={item.id}>
            {item.imageUrl?<img src={item.imageUrl} alt="" className="aspect-[4/3] w-full object-cover"/>:<div className="flex aspect-[4/3] items-center justify-center bg-muted"><Loader2 className="h-6 w-6 animate-spin"/></div>}
            <CardContent className="space-y-2 pt-4">
              <Input placeholder="Nome (obrigatório)" value={item.name} onChange={e=>updateBulkItem(item.id,{name:e.target.value})}/>
              <Input type="number" min="0" step="0.01" placeholder="Preço (obrigatório)" value={item.price} onChange={e=>updateBulkItem(item.id,{price:e.target.value})}/>
              {item.classifying?<p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin"/>A IA está a analisar a foto…</p>:null}
              <Input placeholder="Categoria (sugestão da IA — edita se não estiver certa)" value={item.category??''} onChange={e=>updateBulkItem(item.id,{category:e.target.value||null})}/>
              <Input placeholder="Cor (sugestão da IA — edita se não estiver certa)" value={item.color??''} onChange={e=>updateBulkItem(item.id,{color:e.target.value||null})}/>
              <Textarea placeholder="Descrição" value={item.description} onChange={e=>updateBulkItem(item.id,{description:e.target.value})}/>
              {item.error?<p className="text-xs text-destructive">{item.error}</p>:null}
              <Button size="sm" variant="ghost" onClick={()=>removeBulkItem(item.id)}><Trash2/>Remover</Button>
            </CardContent>
          </Card>)}</div>
          <Button onClick={()=>void saveAllBulk()} disabled={bulkSaving}>{bulkSaving?<Loader2 className="animate-spin"/>:<Plus/>}Guardar todos</Button>
        </>:null}
      </CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.length===0?<Card className="sm:col-span-2 xl:col-span-3"><CardContent className="py-10 text-center text-muted-foreground">Sem produtos.</CardContent></Card>:products.map(p=><ProductCard key={p.id} p={p} onToggle={()=>void toggleProduct(p)} onRemove={()=>void removeProduct(p.id)} onSave={patch=>void saveProductEdits(p,patch)}/>)}</div></TabsContent>
      <TabsContent value="external" className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><Card><CardHeader><CardTitle>Ligar API de catálogo</CardTitle><CardDescription>Teste antes de guardar.</CardDescription></CardHeader><CardContent><form onSubmit={submitSource} className="space-y-4"><div className="space-y-2"><Label>Nome</Label><Input required value={sourceForm.name} onChange={e=>setSourceForm({...sourceForm,name:e.target.value})}/></div><div className="space-y-2"><Label>URL base HTTPS</Label><Input type="url" required value={sourceForm.base_url} onChange={e=>setSourceForm({...sourceForm,base_url:e.target.value})}/></div><div className="space-y-2"><Label>Caminho</Label><Input value={sourceForm.search_path} onChange={e=>setSourceForm({...sourceForm,search_path:e.target.value})}/></div><div className="space-y-2"><Label>Autenticação</Label><select className="h-8 w-full rounded-lg border bg-background px-2.5" value={sourceForm.auth_type} onChange={e=>setSourceForm({...sourceForm,auth_type:e.target.value})}><option value="none">Sem autenticação</option><option value="bearer">Bearer token</option><option value="api_key_header">Chave no cabeçalho</option></select></div>{sourceForm.auth_type==='api_key_header'?<Input placeholder="Nome do cabeçalho" value={sourceForm.auth_header} onChange={e=>setSourceForm({...sourceForm,auth_header:e.target.value})}/>:null}{sourceForm.auth_type!=='none'?<Input type="password" placeholder="Token ou chave" value={sourceForm.auth_secret} onChange={e=>setSourceForm({...sourceForm,auth_secret:e.target.value})}/>:null}<div className="space-y-2"><Label>Mapeamento JSON</Label><Textarea className="min-h-72 font-mono text-xs" value={sourceForm.field_mapping} onChange={e=>setSourceForm({...sourceForm,field_mapping:e.target.value})}/></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>void testSource()} disabled={testing}>{testing?<Loader2 className="animate-spin"/>:<RefreshCw/>}Testar</Button><Button type="submit" disabled={savingSource}>{savingSource?<Loader2 className="animate-spin"/>:<Plus/>}Guardar</Button></div></form>{preview.length?<div className="mt-5 space-y-2"><p className="font-medium">Pré-visualização</p>{preview.map(x=><div key={x.id} className="flex items-center gap-3 rounded-lg border p-2">{x.imageUrl?<img src={x.imageUrl} alt="" className="h-12 w-12 rounded object-cover"/>:null}<div><p className="font-medium">{x.name}</p><p className="text-sm text-muted-foreground">{x.price} {x.currency}</p></div></div>)}</div>:null}</CardContent></Card><Card className="h-fit"><CardHeader><CardTitle>APIs ligadas</CardTitle></CardHeader><CardContent className="space-y-3">{apiSources.length===0?<p className="text-sm text-muted-foreground">Nenhuma API externa.</p>:apiSources.map(s=><div key={s.id} className="rounded-lg border p-3"><p className="font-medium">{s.name}</p><p className="break-all text-xs text-muted-foreground">{s.base_url}</p><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={()=>void toggleSource(s)}>{s.is_active?'Desactivar':'Activar'}</Button><Button size="sm" variant="destructive" onClick={()=>void removeSource(s.id)}><Trash2/>Remover</Button></div></div>)}</CardContent></Card></TabsContent>
      <TabsContent value="database" className="mt-4"><DatabaseIntegrations /></TabsContent>
    </Tabs>
  </div>
}
