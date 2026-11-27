# Villar: the object stage (focus v2)

The founder's brief, 27 Nov: a tap or click on any item should move the camera and the dashboard smoothly, "like in GTA", to that item. The item lands in the centre of the screen. There you can turn it, with proper rotation logic: smooth braking and settling. In one tap you can change its style, colour and so on. Seamless, smooth, sharp and photoreal. The user should be able to put their apartment together as fast and as simply as possible.

Principle: **one surface, three verbs.** *Look* (turn it), *change* (one tap), *move on* (next item). Use direct manipulation and Undo, never confirmation dialogs. Every animation can be interrupted and picks up from its current velocity.

Speed target: re-style a whole room in **under 60 seconds**. Entering is 1 tap, each change is 1 tap, the next item is 1 tap.

## 1. Enter, move, leave
- **Tap/click an item.** The camera flies in one motion, a critically-damped spring of 550–700 ms scaled by distance.
  - The dashboard slides in on the same curve, starting 60 ms after the camera.
  - The room HUD recedes: budget bar, style picker, chat.
  - Nothing pops, and there is no second "settle" move.
- **Framing.** The item is centred in the free part of the stage: the stage minus the card on desktop, or minus the sheet on phone.
  - **Centre:** within ±3 % of the free area's centre.
  - **Size:** the item fills about 55 % of the free height or 60 % of the free width, whichever binds first. The size is consistent across items within ±8 %.
  - **Angle:** the item's beauty angle, a ¾ front view at 25–30° yaw off its front. Camera elevation is 15–20°, and eye level for tall items.
  - **Line of sight:** the camera always has a clear view of the item (it already does).
- **Spotlight.** The room around the item drops −0.3 EV with a soft depth of field. There is no hard vignette, and the item keeps its catalogue colour.
- **Tap another item while focused.** The camera glides straight there without zooming out, and the card content crossfades. A tap mid-flight retargets from the current velocity.
- **Leave** by any of these: a tap on empty space, Esc, the back gesture, ✕, or swiping the sheet down on phone. The camera returns to the view the user came from, not to a reset view.

## 2. Turn it (inspect)
- **Horizontal drag** on the stage (outside the card) turns the item around its own vertical axis, in place.
  - **Gain:** a drag across about 1.2 stage widths is 360° on desktop. A full screen width is about 300° on phone.
- **Release.** The item keeps spinning with inertia from the last ~80 ms of the drag.
  - **Friction:** exponential; the velocity halves every ~120 ms.
  - **Rest:** a critically-damped spring settles the item on the nearest rest angle. Rest angles sit every 45°: front, ¾, side, back. This is the "фиксация".
  - **Slow release:** below 30°/s it settles directly, in ≤ 300 ms.
  - **Overshoot:** no more than 4°.
  - **Haptic:** an 8 ms tick on the snap where `navigator.vibrate` exists.
- **Dial.** A thin arc dial under the item shows the angle, with ticks at the rest angles. It fades 800 ms after the item settles.
- **Vertical drag** tilts the camera between 5° and 45° elevation. At the limits it rubber-bands with resistance 0.35, then springs back.
- **Pinch or wheel** zooms between 0.7× and 1.6× of the framing distance, rubber-banded the same way.
- **Double-tap or double-click** on the item resets it to the beauty angle at its home orientation.
- **No clipping, ever.** While the item is away from its home angle it is on the stage:
  - the room dims to −0.7 EV with a stronger depth of field;
  - the item is drawn over the room (depth cleared for the item layer), with a soft contact shadow on an invisible turntable.
  - When the item is back at 0°, the room returns to normal and the item sits in the room again.
  - A sofa never cuts through a wall.
- **Inspection is not placement.** Leaving focus or swapping the item springs it back to its home orientation in 400 ms. Free re-placement ("Переставить") is a later feature and out of scope.

## 3. Change it in one tap (the card)
The rows below are in order, and each row hides when it has nothing to show:
- **Header:** name, price, size, and the pinned state. ‹ › move to the previous/next item (§4).
- **Colour & material:** swatches of *real* catalogue variants of the same model family, for example the Luna armchair in leather or fabric.
  - Never recolour anything that isn't sold that way. What you see must be orderable.
  - A tap swaps the item with a 350 ms dissolve. The camera stays, and so does the turntable angle.
- **Other models:** the same slot and the same style, as a horizontal carousel. Each tile carries a thumbnail and the price difference (+/− AED). The current item is marked, and tiles are sorted by price. A tap swaps.
- **From other styles:** a carousel of the same slot from the other style packs. A tap swaps **only this item**.
  - The bigger move, «Подстроить комнату под этот стиль», follows as a suggestion chip with Undo, not as a modal.
- **Foot:**
  - «Убрать из комнаты», when the slot may be empty.
  - «Вернуть», for 10 s after any change.
  - ✕.
- **Live total:** the room total animates on every change, and the budget slider follows.
- **Phone:** a bottom sheet with two detents.
  - **Peek (~34 %):** the header plus one carousel row.
  - **Expanded (~70 %):** all rows.
  - The item is always framed above the sheet. A detent change re-frames the camera in the same motion.
- **Keyboard:**
  - **Card:** Tab moves between rows, arrows move within a row, Enter applies.
  - **Stage:** ←/→ turn to the previous/next rest angle, ↑/↓ tilt, +/− zoom, 0 resets, [ ] move to the previous/next item, Esc leaves.
- **Live region:** an aria-live polite region announces each swap and the new total.

## 4. Move on (walk the room)
- ‹ › in the header, [ ] on the keyboard, or a horizontal swipe on the card header on phone.
- **Order:** left to right as the items appeared on screen when focus was entered, then the next zone. It wraps within the room.
- The camera glides from item to item and the card crossfades. This is how the 60-second room happens.

## 5. Motion system
- **One spring family for everything:** camera, card, dissolve, snap and sheet. It lives in `site/js/ui/motion.js` and is mirrored in the engine.
- **No fixed-duration tweens that ignore input.** Every new input retargets from the current position and velocity.
- **Frame budget:**
  - **Desktop:** no frame over 50 ms during a flight, a turn or a swap.
  - **Phone:** at least 45 fps.
  - **Swaps:** assets are prefetched when the card opens, for the visible tiles first.
- **Photo mode** (see PHOTOREAL.md, "Live → Photo"): when the focused item rests, its close-up develops into a photo. Any touch goes back to live.

## 6. Acceptance: every batch is reviewed against this
- **Interaction reviewer (playtest).** A timed task script on desktop RU and phone EN:
  1. Focus the sofa.
  2. Turn it to the back and let it settle.
  3. Change its colour.
  4. Swap the coffee table for another model.
  5. Take the rug from Mediterranean.
  6. Go to the next item.
  7. Undo.
  8. Leave.

  Record taps, seconds, hesitations and every surprise. The target is ≤ 12 taps and ≤ 40 s with no hesitation over 2 s.
- **Design reviewer.**
  - Hierarchy, copy and focus ring.
  - The card and sheet at 1280, 1440 and 390 px.
  - Motion quality frame by frame: no pop, no double move, overshoot ≤ 4°.
  - No clipping while turning.
- **Render reviewer.** The spotlight look and the photo-mode close-ups.
- **Tech reviewer.**
  - Frame times during flight, turn and swap.
  - Interrupt and retarget correctness.
  - No leaks across 50 focus cycles.
