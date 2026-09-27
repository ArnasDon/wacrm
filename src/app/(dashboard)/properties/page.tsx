'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, MapPin, Building, DollarSign, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function PropertiesPage() {
  const t = useTranslations('Properties.page');
  const supabase = createClient();

  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('properties')
      .select('*')
      .order('created_at', { ascending: false });

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`title.ilike.${term},location.ilike.${term}`);
    }

    if (typeFilter.trim()) {
      query = query.eq('property_type', typeFilter.trim());
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
    } else {
      setProperties(data ?? []);
    }
    setLoading(false);
  }, [supabase, search, typeFilter]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Add property form not implemented here per plan but could be a dialog */}
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Input
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder={t('filterType')}
            className="w-full max-w-[200px] bg-card border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : properties.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <Building className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('noProperties')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((property) => (
            <Link key={property.id} href={`/properties/${property.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardHeader className="p-4 pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-base font-semibold line-clamp-1">{property.title}</CardTitle>
                    {property.price && (
                      <Badge variant="secondary" className="shrink-0 flex items-center gap-1">
                        <DollarSign className="size-3" />
                        {property.price.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                    {property.location && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="size-3.5" />
                        <span className="truncate">{property.location}</span>
                      </div>
                    )}
                    {property.property_type && (
                      <div className="flex items-center gap-1.5">
                        <Building className="size-3.5" />
                        <span>{property.property_type}</span>
                        {property.bedrooms && (
                          <span className="ml-1 border-l pl-2 border-border">{property.bedrooms} Beds</span>
                        )}
                      </div>
                    )}
                  </div>
                  {property.tags && property.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {property.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
                          {tag}
                        </span>
                      ))}
                      {property.tags.length > 3 && (
                        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
                          +{property.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
