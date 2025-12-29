# Design Guidelines: Single Page Application

## Design Approach
**System Selected**: Hybrid approach combining Airbnb's card aesthetics with Linear's typography precision and Stripe's visual restraint. This creates a modern, professional single-page experience suitable for portfolio, product showcase, or agency use.

## Core Design Elements

### Typography
- **Primary Font**: Inter (Google Fonts) - headings, UI elements
- **Secondary Font**: Source Sans Pro - body text, descriptions
- **Heading Hierarchy**:
  - H1: text-6xl md:text-7xl, font-bold, tracking-tight
  - H2: text-4xl md:text-5xl, font-semibold
  - H3: text-2xl md:text-3xl, font-semibold
  - Body: text-base md:text-lg, leading-relaxed

### Layout System
**Spacing Units**: Use Tailwind units of 4, 6, 8, 12, 16, 20, 24, 32 (e.g., p-8, mb-12, gap-6)
- Container: max-w-7xl mx-auto px-6 md:px-8
- Section padding: py-16 md:py-24
- Component spacing: gap-8 md:gap-12

## Page Structure

### Hero Section (100vh)
- Full-viewport immersive introduction with large background image
- Image: High-quality lifestyle/product/workspace image that establishes brand tone
- Content positioned center-left with max-w-2xl
- Headline + supporting text + dual CTA buttons (primary + secondary)
- Buttons use backdrop-blur-lg bg-white/10 treatment over image
- Subtle scroll indicator at bottom

### Feature Showcase (multi-column)
- 3-column grid on desktop (grid-cols-1 md:grid-cols-3)
- Each card includes: icon (72x72), heading, description, subtle hover lift effect
- Cards use rounded-2xl with border treatment
- Background: Subtle gradient or solid depending on brand

### About/Story Section (asymmetric 2-column)
- Desktop: 60/40 split with image on left, content on right
- Image: Team photo, product in use, or brand imagery
- Content: Rich text with pull quotes and supporting details
- Mobile: Stack vertically

### Metrics/Stats Bar
- 4-column grid (grid-cols-2 md:grid-cols-4)
- Large numbers with descriptive labels
- Centered alignment, generous spacing

### Testimonial/Social Proof
- 3-card grid showcasing customer feedback
- Each card: avatar image, quote, name/title
- Balanced, equal-height cards with consistent padding

### CTA Section
- Full-width with centered content
- Strong headline + supporting text + primary action button
- Background: Gradient or solid with high contrast to rest of page

### Footer
- 3-column layout: Brand/description, Quick Links, Contact/Social
- Newsletter signup form integrated
- Legal links and copyright

## Component Library

### Buttons
- Primary: Large (px-8 py-4), rounded-xl, font-semibold
- Secondary: Same size, outline variant
- Icon buttons: rounded-full, consistent 48px touch target

### Cards
- Border radius: rounded-2xl
- Padding: p-8 md:p-10
- Subtle shadow on hover: hover:shadow-xl transition-shadow
- Maintain aspect ratios for visual consistency

### Forms (if applicable)
- Input fields: rounded-lg, px-4 py-3
- Labels: text-sm font-medium, mb-2
- Focus states: ring treatment

### Navigation
- Sticky header with backdrop-blur
- Logo left, nav items right
- Hamburger menu on mobile
- Smooth scroll to sections

## Images

### Required Images:
1. **Hero Background**: Full-width, high-quality (1920x1080+), dramatic/inspiring scene relevant to brand
2. **About Section**: Authentic photo showing team, product, or process (800x600)
3. **Testimonial Avatars**: 3 customer photos (128x128, circular)
4. **Feature Icons**: Use Heroicons library via CDN (no custom SVGs)

**Hero Image**: Yes - Large, full-viewport background image with overlay for text readability

## Animations
Minimal, purposeful animations only:
- Smooth scroll behavior between sections
- Subtle hover lifts on cards (translateY(-4px))
- Fade-in on scroll for sections (use Intersection Observer)
- Button hover states (built-in, no custom animations)

## Accessibility
- Semantic HTML5 structure
- ARIA labels for interactive elements
- Keyboard navigation support
- Focus indicators on all interactive elements
- Sufficient color contrast throughout

## Responsive Breakpoints
- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Single column on mobile, expand to multi-column at md breakpoint
- Adjust typography scale and spacing for each breakpoint