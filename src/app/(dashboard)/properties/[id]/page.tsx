'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Building, DollarSign, Bed, ChevronLeft, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function PropertyDetailPage() {
  const t = useTranslations('Properties.detail');
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();

  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProperty = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('id', params.id as string)
      .single();
      
    if (!error && data) {
      setProperty(data);
    }
    setLoading(false);
  }, [supabase, params.id]);

  useEffect(() => {
    fetchProperty();
  }, [fetchProperty]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Property not found.</p>
        <Button variant="link" onClick={() => router.push('/properties')}>
          Back to Properties
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/properties')} className="shrink-0">
          <ChevronLeft className="size-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{property.title}</h1>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="grid gap-6 sm:grid-cols-2">
            {property.price && (
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <DollarSign className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('price')}</p>
                  <p className="text-lg font-semibold">{property.price.toLocaleString()}</p>
                </div>
              </div>
            )}
            
            {property.location && (
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MapPin className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Location</p>
                  <p className="text-lg font-semibold">{property.location}</p>
                </div>
              </div>
            )}
            
            {property.property_type && (
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Building className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('type')}</p>
                  <p className="text-lg font-semibold">{property.property_type}</p>
                </div>
              </div>
            )}
            
            {property.bedrooms !== undefined && property.bedrooms !== null && (
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bed className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{t('bedrooms')}</p>
                  <p className="text-lg font-semibold">{property.bedrooms}</p>
                </div>
              </div>
            )}
          </div>
          
          {property.tags && property.tags.length > 0 && (
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-sm font-medium text-muted-foreground mb-3">{t('tags')}</p>
              <div className="flex flex-wrap gap-2">
                {property.tags.map((tag, i) => (
                  <Badge key={i} variant="secondary">{tag}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
