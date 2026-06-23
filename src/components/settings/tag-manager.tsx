'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Tag } from '@/types';

const PRESET_COLORS = [
  { name: 'Vermelho', value: '#ef4444' },
  { name: 'Laranja', value: '#f97316' },
  { name: 'Âmbar', value: '#f59e0b' },
  { name: 'Esmeralda', value: '#10b981' },
  { name: 'Ciano', value: '#06b6d4' },
  { name: 'Azul', value: '#3b82f6' },
  { name: 'Violeta', value: '#8b5cf6' },
  { name: 'Rosa', value: '#ec4899' },
];

export function TagManager() {
  const supabase = createClient();
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[3].value);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchTags(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchTags(userId: string) {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setTags(data || []);
    } catch (err) {
      console.error('Falha ao buscar tags:', err);
      toast.error('Falha ao carregar tags');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) {
      toast.error('O nome da tag é obrigatório');
      return;
    }

    try {
      setSaving(true);
      if (!user) {
        toast.error('Não autenticado');
        return;
      }

      const { error } = await supabase
        .from('tags')
        .insert({
          user_id: user.id,
          name: newTagName.trim(),
          color: selectedColor,
        });

      if (error) throw error;

      toast.success('Tag criada com sucesso');
      setDialogOpen(false);
      setNewTagName('');
      setSelectedColor(PRESET_COLORS[3].value);
      if (user) await fetchTags(user.id);
    } catch (err) {
      console.error('Erro ao criar tag:', err);
      toast.error('Falha ao criar tag');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(tag: Tag) {
    setTagToDelete(tag);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!tagToDelete) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('tags')
        .delete()
        .eq('id', tagToDelete.id);

      if (error) throw error;

      toast.success('Tag excluída');
      setTags((prev) => prev.filter((t) => t.id !== tagToDelete.id));
      setDeleteDialogOpen(false);
      setTagToDelete(null);
    } catch (err) {
      console.error('Erro ao excluir tag:', err);
      toast.error('Falha ao excluir tag');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Tags</h2>
          <p className="text-sm text-slate-400">Organize seus contatos com tags coloridas.</p>
        </div>
        <Button
          onClick={() => {
            setNewTagName('');
            setSelectedColor(PRESET_COLORS[3].value);
            setDialogOpen(true);
          }}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="size-4" />
          Nova Tag
        </Button>
      </div>

      {tags.length === 0 ? (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-slate-400 text-sm">Nenhuma tag ainda.</p>
            <p className="text-slate-500 text-xs mt-1">Crie tags para categorizar seus contatos.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                    border: `1px solid ${tag.color}40`,
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <button
                    onClick={() => confirmDelete(tag)}
                    className="ml-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Tag Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Nova Tag</DialogTitle>
            <DialogDescription className="text-slate-400">
              Crie uma nova tag com um nome e cor.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-slate-300">Nome da Tag</Label>
              <Input
                placeholder="ex: Cliente VIP"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300">Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setSelectedColor(color.value)}
                    className="relative size-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900"
                    style={{
                      backgroundColor: color.value,
                      boxShadow: selectedColor === color.value ? `0 0 0 2px rgb(15 23 42), 0 0 0 4px ${color.value}` : 'none',
                    }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label className="text-slate-300">Pré-visualização</Label>
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
                  style={{
                    backgroundColor: `${selectedColor}20`,
                    color: selectedColor,
                    border: `1px solid ${selectedColor}40`,
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: selectedColor }}
                  />
                  {newTagName || 'Nome da Tag'}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Criando...
                </>
              ) : (
                'Criar Tag'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Excluir Tag</DialogTitle>
            <DialogDescription className="text-slate-400">
              Tem certeza que deseja excluir a tag &quot;{tagToDelete?.name}&quot;? Ela será removida
              de todos os contatos. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-slate-900 border-slate-700">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir Tag'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
