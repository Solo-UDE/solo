# Dark Mode

- Dark mode is about maintaining the same contrast ratios as light mode, not simply inverting colors
- Dark mode doesn't need to preserve every detail of the light mode design — it just needs to look good
- Never keep large branded/colored panels in dark mode; instead use the same background color and add a light divider between sections
- Style cards only slightly lighter than the page background (e.g. `dark:bg-gray-900` on a `dark:bg-gray-950` page); add a `dark:inset-ring dark:inset-ring-white/5` for definition
- Remove all shadows in dark mode — use `dark:shadow-none`
- Make decorative quote marks in testimonials very faint (e.g. `dark:text-white/5`)
- Never use multiple heading text colors in dark mode (e.g. dark gray + brand color); use a single light color like `white` or `gray-100` for all heading text
- Hide decorative background images (gradient blobs, textures, glows) in dark mode with `dark:hidden` — they rarely translate well
- When inverting `<img>` for dark mode with `dark:invert`, always also add `dark:grayscale` to desaturate them
- On dark-mode-only sites, add the `scheme-only-dark` class to `<html>` or the top-level element — ensures native elements like scrollbars, form controls, and `color-scheme` render in dark mode
