-- Gear items for the packing list feature (event-specific)
CREATE TABLE IF NOT EXISTS gear_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  rental_link TEXT,
  product_link TEXT,
  is_available_to_rent BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guest check-off state — persists across devices via guest_id
CREATE TABLE IF NOT EXISTS guest_gear_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_id UUID REFERENCES guests(id) ON DELETE CASCADE NOT NULL,
  gear_item_id UUID REFERENCES gear_items(id) ON DELETE CASCADE NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guest_id, gear_item_id)
);

-- Pre-populate East event gear items (id: 49172119-3430-495e-ae41-f72974ac8233)
INSERT INTO gear_items (event_id, name, category, description, is_available_to_rent, sort_order) VALUES
  -- Shelter
  ('49172119-3430-495e-ae41-f72974ac8233', 'Snow Peak Tent',                          'Shelter',    'Snow Peak tents required. Rentals available at Guest Services.', TRUE,  1),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Sleeping Bag',                            'Shelter',    NULL,                                                            FALSE, 2),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Sleeping Pad',                            'Shelter',    NULL,                                                            FALSE, 3),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Camping Pillow',                          'Shelter',    NULL,                                                            FALSE, 4),
  -- Clothing
  ('49172119-3430-495e-ae41-f72974ac8233', 'Waterproof coat and rain gear',           'Clothing',   NULL, FALSE, 1),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Base layers for cool mornings and evenings', 'Clothing', NULL, FALSE, 2),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Hiking boots or trail shoes',             'Clothing',   NULL, FALSE, 3),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Swimsuit and Towel',                      'Clothing',   NULL, FALSE, 4),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Yoga Mat (if attending yoga)',            'Clothing',   NULL, FALSE, 5),
  -- Cooking
  ('49172119-3430-495e-ae41-f72974ac8233', 'Cooler',                                  'Cooking',    NULL, FALSE, 1),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Pots, pans and cookware',                 'Cooking',    NULL, FALSE, 2),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Food and ingredients for three days',     'Cooking',    NULL, FALSE, 3),
  -- Essentials
  ('49172119-3430-495e-ae41-f72974ac8233', 'Headlamp or flashlight',                  'Essentials', NULL, FALSE, 1),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Mobile charging device',                  'Essentials', NULL, FALSE, 2),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Sunscreen and bug spray',                 'Essentials', NULL, FALSE, 3),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Water bottle',                            'Essentials', NULL, FALSE, 4),
  ('49172119-3430-495e-ae41-f72974ac8233', 'Personal toiletries',                     'Essentials', NULL, FALSE, 5);
