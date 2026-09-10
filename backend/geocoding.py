"""
Geocoding utilities using Yandex Geocoder API
Converts addresses to coordinates and vice versa
"""

import os
import requests
from typing import Optional, Tuple

YANDEX_GEOCODER_API_KEY = os.environ.get("YANDEX_GEOCODER_API_KEY", "")
YANDEX_GEOCODER_URL = "https://geocode-maps.yandex.ru/1.x/"

def geocode_address(city: str, address: Optional[str] = None) -> Optional[Tuple[float, float]]:
    """
    Convert city and address to coordinates (latitude, longitude)

    Args:
        city: City name (e.g., "Москва")
        address: Street address (e.g., "ул. Ленина, д. 10")

    Returns:
        Tuple of (latitude, longitude) or None if not found
    """
    if not city:
        return None

    # Build full address
    full_address = f"{city}, Россия"
    if address:
        full_address = f"{city}, {address}, Россия"

    try:
        params = {
            'geocode': full_address,
            'format': 'json',
            'results': 1
        }

        if YANDEX_GEOCODER_API_KEY:
            params['apikey'] = YANDEX_GEOCODER_API_KEY

        response = requests.get(YANDEX_GEOCODER_URL, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()

        # Parse response
        geo_objects = data.get('response', {}).get('GeoObjectCollection', {}).get('featureMember', [])

        if not geo_objects:
            return get_city_center_fallback(city)

        # Get first result coordinates
        point = geo_objects[0]['GeoObject']['Point']['pos']
        longitude, latitude = map(float, point.split())

        return (latitude, longitude)

    except Exception as e:
        print(f"Geocoding error: {e}")
        return get_city_center_fallback(city)

def get_city_center_fallback(city: str) -> Optional[Tuple[float, float]]:
    """
    Return approximate city center coordinates as fallback
    """
    city_coords = {
        'Москва': (55.751574, 37.573856),
        'Санкт-Петербург': (59.9343, 30.3351),
        'Новосибирск': (55.0084, 82.9357),
        'Екатеринбург': (56.8389, 60.6057),
        'Казань': (55.8304, 49.0661),
        'Нижний Новгород': (56.2965, 43.9361),
        'Челябинск': (55.1644, 61.4368),
        'Самара': (53.1959, 50.1002),
        'Омск': (54.9885, 73.3242),
        'Ростов-на-Дону': (47.2357, 39.7015),
        'Уфа': (54.7388, 55.9721),
        'Красноярск': (56.0153, 92.8932),
        'Воронеж': (51.6605, 39.2005),
        'Пермь': (58.0105, 56.2502),
        'Волгоград': (48.7080, 44.5133),
        'Краснодар': (45.0355, 38.9753),
    }

    return city_coords.get(city)

def reverse_geocode(latitude: float, longitude: float) -> Optional[str]:
    """
    Convert coordinates to address

    Returns:
        Address string or None
    """
    try:
        params = {
            'geocode': f"{longitude},{latitude}",
            'format': 'json',
            'results': 1
        }

        if YANDEX_GEOCODER_API_KEY:
            params['apikey'] = YANDEX_GEOCODER_API_KEY

        response = requests.get(YANDEX_GEOCODER_URL, params=params, timeout=5)
        response.raise_for_status()

        data = response.json()
        geo_objects = data.get('response', {}).get('GeoObjectCollection', {}).get('featureMember', [])

        if not geo_objects:
            return None

        address = geo_objects[0]['GeoObject']['metaDataProperty']['GeocoderMetaData']['text']
        return address

    except Exception as e:
        print(f"Reverse geocoding error: {e}")
        return None
