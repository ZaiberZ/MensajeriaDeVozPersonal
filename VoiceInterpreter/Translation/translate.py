import json
import sys


def get_translation(source_code, target_code):
    from argostranslate import translate

    installed_languages = translate.get_installed_languages()
    source_language = next(
        (language for language in installed_languages if language.code == source_code), None
    )
    target_language = next(
        (language for language in installed_languages if language.code == target_code), None
    )
    if source_language is None or target_language is None:
        return None

    return source_language.get_translation(target_language)


def check_installation():
    status = {
        "argosTranslateAvailable": False,
        "spanishToEnglishModelAvailable": False,
        "englishToSpanishModelAvailable": False,
        "errorMessage": "",
    }

    try:
        import argostranslate  # noqa: F401

        status["argosTranslateAvailable"] = True
        status["spanishToEnglishModelAvailable"] = get_translation("es", "en") is not None
        status["englishToSpanishModelAvailable"] = get_translation("en", "es") is not None
    except Exception as exception:
        status["errorMessage"] = str(exception)

    print(json.dumps(status))


def install_models():
    from argostranslate import package

    print("Updating Argos package index...", flush=True)
    package.update_package_index()
    available_packages = package.get_available_packages()

    for source_code, target_code in (("es", "en"), ("en", "es")):
        if get_translation(source_code, target_code) is not None:
            print(f"{source_code}->{target_code}: already installed", flush=True)
            continue

        selected_package = next(
            (
                item
                for item in available_packages
                if item.from_code == source_code and item.to_code == target_code
            ),
            None,
        )
        if selected_package is None:
            raise RuntimeError(f"No package is available for {source_code}->{target_code}.")

        print(f"{source_code}->{target_code}: downloading", flush=True)
        package.install_from_path(selected_package.download())
        print(f"{source_code}->{target_code}: installed", flush=True)


def translate_text(source_code, target_code):
    text = sys.stdin.read()
    if not text.strip():
        raise ValueError("The text to translate is empty.")

    translation = get_translation(source_code, target_code)
    if translation is None:
        raise RuntimeError(f"The translation model {source_code}->{target_code} is not installed.")

    translated_text = translation.translate(text)
    if not translated_text.strip():
        raise RuntimeError("Argos Translate returned an empty result.")

    sys.stdout.write(translated_text.strip())


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--check":
        check_installation()
        return

    if len(sys.argv) == 2 and sys.argv[1] == "--install-models":
        install_models()
        return

    if len(sys.argv) != 3:
        raise ValueError("Expected source and target language arguments.")

    translate_text(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    try:
        main()
    except Exception as exception:
        print(str(exception), file=sys.stderr)
        sys.exit(1)
