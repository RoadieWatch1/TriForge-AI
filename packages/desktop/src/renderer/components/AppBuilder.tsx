import React, { useState } from 'react';
import { BuilderHome } from '../builder/BuilderHome';
import { WebAppStudio } from '../builder/WebAppStudio';
import { MarketingStudio } from '../builder/MarketingStudio';
import { BrandStudio } from '../builder/BrandStudio';
import { ProductStudio } from '../builder/ProductStudio';
import { FashionStudio } from '../builder/FashionStudio';

type BuilderScreen = 'home' | 'webapp' | 'marketing' | 'brand' | 'product' | 'fashion';

interface Props {
  onBack: () => void;
}

export function AppBuilder({ onBack }: Props) {
  const [builderScreen, setBuilderScreen] = useState<BuilderScreen>('home');

  if (builderScreen === 'webapp')    return <WebAppStudio    onBack={() => setBuilderScreen('home')} />;
  if (builderScreen === 'marketing') return <MarketingStudio onBack={() => setBuilderScreen('home')} />;
  if (builderScreen === 'brand')     return <BrandStudio     onBack={() => setBuilderScreen('home')} />;
  if (builderScreen === 'product')   return <ProductStudio   onBack={() => setBuilderScreen('home')} />;
  if (builderScreen === 'fashion')   return <FashionStudio   onBack={() => setBuilderScreen('home')} />;

  return <BuilderHome onNavigate={setBuilderScreen} onBack={onBack} />;
}
