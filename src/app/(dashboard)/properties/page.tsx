'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  MapPin,
  Building,
  DollarSign,
  Loader2,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { PullToRefresh } from '@/components/layout/pull-to-refresh';

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProperties();
  }, [fetchProperties]);

  return (
    <PullToRefresh onRefresh={fetchProperties}>
      <div className="space-y-6 pb-20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Add property form not implemented here per plan but could be a dialog */}
          </div>
        </div>

        <div className="bg-background/95 sticky top-0 z-10 -mx-4 space-y-2 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative w-full max-w-sm">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="bg-card border-border text-foreground placeholder:text-muted-foreground pl-8"
              />
            </div>
            <Input
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              placeholder={t('filterType')}
              className="bg-card border-border text-foreground placeholder:text-muted-foreground w-full max-w-[200px]"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <Loader2 className="text-primary size-6 animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Building className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">{t('noProperties')}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <Link key={property.id} href={`/properties/${property.id}`}>
                <Card className="hover:border-primary/50 h-full cursor-pointer transition-colors">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="line-clamp-1 text-base font-semibold">
                        {property.title}
                      </CardTitle>
                      {property.price && (
                        <Badge
                          variant="secondary"
                          className="flex shrink-0 items-center gap-1"
                        >
                          <DollarSign className="size-3" />
                          {property.price.toLocaleString()}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <div className="text-muted-foreground flex flex-col gap-2 text-sm">
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
                            <span className="border-border ml-1 border-l pl-2">
                              {property.bedrooms} Beds
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {property.tags && property.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {property.tags.slice(0, 3).map((tag, i) => (
                          <span
                            key={i}
                            className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium"
                          >
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
    </PullToRefresh>
  );
}
